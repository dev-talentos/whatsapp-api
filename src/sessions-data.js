const fs = require("fs");
const { resolve } = require("path");

const folderPath = resolve(__dirname, "../sessions-data/");
const sessionFilePath = resolve(folderPath, "./sessions.json");

console.log("pathFolder2", folderPath);

const getSessions = async () => {
	const sessions = JSON.parse(
		(await fs.promises.readFile(resolve(sessionFilePath))) || []
	);

	return sessions;
};

const addSession = async (sessioName, webhookUrl = null) => {
	if (!sessioName) {
		throw new Error("Nome da sessão é obrigatoria");
	}

	const sessions = await getSessions();

	const data = [{ sessioName, webhookUrl }, ...sessions];

	await fs.promises.writeFile(pathFolder, JSON.stringify(data));

	return true;
};

const changeWebhookUrl = async (sessionName, webhookUrl = null) => {
	if (!sessionName) {
		throw new Error("Nome da sessão é obrigatoria");
	}

	const sessions = await getSessions();

	const data = sessions.map((session) =>
		session.sessionName === sessionName
			? { ...session, webhookUrl }
			: session
	);

	await fs.promises.writeFile(pathFolder, JSON.stringify(data));

	return true;
};

module.exports = {
	addSession,
	getSessions,
	changeWebhookUrl,
};
