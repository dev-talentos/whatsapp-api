const fs = require("fs");
const { resolve } = require("path");

const folderPath = resolve(__dirname, "../sessions_data/");
const sessionFilePath = resolve(folderPath, "./sessions.json");

const getSessions = () => {
	const sessions = JSON.parse(
		fs.readFileSync(resolve(sessionFilePath)) || []
	);

	return sessions;
};

const getSessionById = (sessionId) => {
	const sessions = getSessions();

	return sessions.find((s) => s.sessionName === sessionId);
};

const addSession = (sessionName, webhookUrl = null, userAgent = null) => {
	if (!sessionName) {
		throw new Error("Nome da sessão é obrigatoria");
	}

	const sessions = getSessions();

	const data = sessions.some((session) => session.sessionName === sessionName)
		? sessions.map((session) =>
				session.sessionName === sessionName
					? { ...session, webhookUrl, userAgent }
					: session
		  )
		: [{ sessionName, webhookUrl, userAgent }, ...sessions];

	fs.writeFileSync(sessionFilePath, JSON.stringify(data));

	return true;
};

const removeSession = (sessionName) => {
	if (!sessionName) {
		throw new Error("Nome da sessão é obrigatoria");
	}

	const sessions = getSessions();

	const data = sessions.filter(
		(session) => session.sessionName !== sessionName
	);

	fs.writeFileSync(sessionFilePath, JSON.stringify(data));

	return true;
};

const changeWebhookUrl = (sessionName, webhookUrl = null) => {
	if (!sessionName) {
		throw new Error("Nome da sessão é obrigatoria");
	}

	const sessions = getSessions();

	const data = sessions.map((session) =>
		session.sessionName.trim() === sessionName.trim()
			? { ...session, webhookUrl }
			: session
	);

	fs.writeFileSync(sessionFilePath, JSON.stringify(data));

	return true;
};

const changeUserAgent = (sessionName, userAgent = null) => {
	if (!sessionName) {
		throw new Error("Nome da sessão é obrigatoria");
	}

	const sessions = getSessions();

	const data = sessions.map((session) =>
		session.sessionName.trim() === sessionName.trim()
			? { ...session, userAgent }
			: session
	);

	fs.writeFileSync(sessionFilePath, JSON.stringify(data));

	return true;
};

module.exports = {
	changeUserAgent,
	getSessionById,
	addSession,
	removeSession,
	getSessions,
	changeWebhookUrl,
};
