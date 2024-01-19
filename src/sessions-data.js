const fs = require("fs");
const { resolve } = require("path");

const folderPath = resolve(__dirname, "../sessions_data/");
const sessionFilePath = resolve(folderPath, "./sessions.json");

console.log("pathFolder2", folderPath);

const getSessions = async () => {
	const sessions = JSON.parse(
		(await fs.promises.readFile(resolve(sessionFilePath))) || []
	);

	return sessions;
};

const addSession = async (sessionName, webhookUrl = null) => {
	if (!sessionName) {
		throw new Error("Nome da sessão é obrigatoria");
	}

	const sessions = await getSessions();

	const data = [{ sessionName, webhookUrl }, ...sessions];

	await fs.promises.writeFile(sessionFilePath, JSON.stringify(data));

	return true;
};

const changeWebhookUrl = async (sessionName, webhookUrl = null) => {
	if (!sessionName) {
		throw new Error("Nome da sessão é obrigatoria");
	}

	const sessions = await getSessions();

	const data = sessions.map((session) =>
		session.sessionName.trim() === sessionName.trim()
			? { ...session, webhookUrl }
			: session
	);

	await fs.promises.writeFile(sessionFilePath, JSON.stringify(data));

	return true;
};

module.exports = {
	addSession,
	getSessions,
	changeWebhookUrl,
};
