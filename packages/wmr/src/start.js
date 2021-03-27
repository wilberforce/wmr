import server from './server.js';
import wmrMiddleware from './wmr-middleware.js';
import { getFreePort, getServerAddresses, isPortFree } from './lib/net-utils.js';
import { normalizeOptions } from './lib/normalize-options.js';
import { setCwd } from './plugins/npm-plugin/registry.js';
import { formatBootMessage } from './lib/output-utils.js';

/**
 * @typedef OtherOptions
 * @property {string} [host]
 * @property {number} [port]
 * @property {Record<string, string>} [env]
 */

/**
 * @param {Parameters<server>[0] & OtherOptions} options
 */
export default async function start(options = {}) {
	// @todo remove this hack once registry.js is instantiable
	setCwd(options.cwd);

	options = await normalizeOptions(options, 'start');

	// Don't use another free port if the user explicitely
	// requested a specific one.
	const userPort = options.port || process.env.PORT;
	if (userPort !== undefined) {
		if (await isPortFree(+userPort)) {
			options.port = +userPort;
		} else {
			throw new Error(`Another process is already running on port ${userPort}. Please choose a different port.`);
		}
	} else {
		options.port = await getFreePort(8080);
	}

	options.host = options.host || process.env.HOST;

	options.middleware = [].concat(
		// @ts-ignore-next
		options.middleware || [],

		wmrMiddleware({
			...options,
			onError: sendError,
			onChange: sendChanges
		})
	);

	// eslint-disable-next-line
	function sendError(err) {
		if (app.ws.clients.size > 0) {
			app.ws.broadcast({
				type: 'error',
				error: err.clientMessage || err.message,
				codeFrame: err.codeFrame
			});
		} else if (((err.code / 200) | 0) === 2) {
			// skip 400-599 errors, they're net errors logged to console
		} else if (process.env.DEBUG) {
			console.error(err);
		} else {
			const message = err.formatted ? err.formatted : /^Error/.test(err.message) ? err.message : err + '';
			console.error(message);
		}
	}

	// eslint-disable-next-line
	function sendChanges({ changes, reload }) {
		if (options.reload || reload) {
			app.ws.broadcast({ type: 'reload' });
		} else {
			app.ws.broadcast({
				type: 'update',
				changes
			});
		}
	}

	const app = await server(options);
	app.listen(options.port, options.host, () => {
		const addresses = getServerAddresses(app.server.address(), { https: app.http2 });
		const message = `server running at:`;
		process.stdout.write(formatBootMessage(message, addresses));
	});
}
