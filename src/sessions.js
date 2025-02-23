const { Client, LocalAuth } = require("whatsapp-web.js");
const fs = require("fs");
const sessions = new Map();
const {
	baseWebhookURL,
	sessionFolderPath,
	maxAttachmentSize,
	setMessagesAsSeen,
	webVersion,
	webVersionCacheType,
	recoverSessions,
} = require("./config");
const {
	triggerWebhook,
	waitForNestedObject,
	checkIfEventisEnabled,
} = require("./utils");
const {
	getSessions,
	addSession,
	removeSession,
	getSessionById,
} = require("./sessions-data");
const { v4: uuid4 } = require("uuid");
const mime = require("mime-types");
const UserAgent = require("user-agents");
// Function to validate if the session is ready
const validateSession = async (sessionId) => {
	try {
		const returnData = { success: false, state: null, message: "" };

		// Session not Connected 😢
		if (!sessions.has(sessionId) || !sessions.get(sessionId)) {
			returnData.message = "session_not_found";
			return returnData;
		}

		const client = sessions.get(sessionId);
		// wait until the client is created
		await waitForNestedObject(client, "pupPage").catch((err) => {
			return { success: false, state: null, message: err.message };
		});

		// Wait for client.pupPage to be evaluable
		while (true) {
			try {
				if (client.pupPage.isClosed()) {
					return {
						success: false,
						state: null,
						message: "browser tab closed",
					};
				}
				await client.pupPage.evaluate("1");
				break;
			} catch (error) {
				// Ignore error and wait for a bit before trying again
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}

		const state = await client.getState();
		returnData.state = state;
		if (state !== "CONNECTED") {
			returnData.message = "session_not_connected";
			return returnData;
		}

		// Session Connected 🎉
		returnData.success = true;
		returnData.message = "session_connected";
		return returnData;
	} catch (error) {
		console.log(error);
		return { success: false, state: null, message: error.message };
	}
};

// Function to handle client session restoration
const restoreSessions = () => {
	try {
		if (!fs.existsSync(sessionFolderPath)) {
			fs.mkdirSync(sessionFolderPath); // Create the session directory if it doesn't exist
		}
		// Read the contents of the folder
		fs.readdir(sessionFolderPath, (_, files) => {
			// Iterate through the files in the parent folder
			for (const file of files) {
				// Use regular expression to extract the string from the folder name
				const match = file.match(/^session-(.+)$/);
				if (match) {
					const sessionId = match[1];
					console.log("existing session detected", sessionId);
					setupSession(sessionId);
				}
			}
		});
	} catch (error) {
		console.log(error);
		console.error("Failed to restore sessions:", error);
	}
};

// Setup Session
const setupSession = (sessionId, webhookUrl) => {
	try {
		if (sessions.has(sessionId)) {
			return {
				success: false,
				message: `Session already exists for: ${sessionId}`,
				client: sessions.get(sessionId),
			};
		}

		// Disable the delete folder from the logout function (will be handled separately)
		const localAuth = new LocalAuth({
			clientId: sessionId,
			dataPath: sessionFolderPath,
		});
		delete localAuth.logout;
		localAuth.logout = () => {};

		const session = getSessionById(sessionId);

		const userAgent = session?.userAgent
			? session?.userAgent
			: new UserAgent({ deviceCategory: "desktop" });

		console.log("userAgent", userAgent.toString());

		const clientOptions = {
			puppeteer: {
				executablePath: process.env.CHROME_BIN || null,
				//headless: false,
				args: [
					"--no-sandbox",
					"--disable-setuid-sandbox",
					"--disable-gpu",
					"--disable-dev-shm-usage",
				],
			},
			userAgent: userAgent.toString(),
			authStrategy: localAuth,
		};

		if (webVersion) {
			clientOptions.webVersion = webVersion;
			switch (webVersionCacheType.toLowerCase()) {
				case "local":
					clientOptions.webVersionCache = {
						type: "local",
					};
					break;
				case "remote":
					clientOptions.webVersionCache = {
						type: "remote",
						remotePath:
							"https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/" +
							webVersion +
							".html",
					};
					break;
				default:
					clientOptions.webVersionCache = {
						type: "none",
					};
			}
		}

		const client = new Client(clientOptions);

		client
			.initialize()
			.catch((err) => console.log("Initialize error:", err.message));

		if (webhookUrl && session?.webhookUrl !== webhookUrl) {
			addSession(sessionId, webhookUrl, userAgent?.toString());
		}

		initializeEvents(client, sessionId);

		// Save the session to the Map
		sessions.set(sessionId, client);
		return {
			success: true,
			message: "Session initiated successfully",
			client,
		};
	} catch (error) {
		return { success: false, message: error.message, client: null };
	}
};

const initializeEvents = async (client, sessionId) => {
	// check if the session webhook is overridden

	if (recoverSessions) {
		waitForNestedObject(client, "pupPage")
			.then(() => {
				const restartSession = async (sessionId) => {
					sessions.delete(sessionId);
					await client.destroy().catch((e) => {});
					setupSession(sessionId);
				};
				client.pupPage.once("close", function () {
					// emitted when the page closes
					console.log(
						`Browser page closed for ${sessionId}. Restoring`
					);
					restartSession(sessionId);
				});
				client.pupPage.once("error", function () {
					// emitted when the page crashes
					console.log(
						`Error occurred on browser page for ${sessionId}. Restoring`
					);
					restartSession(sessionId);
				});
			})
			.catch((e) => {});
	}

	checkIfEventisEnabled("auth_failure").then((_) => {
		client.on("auth_failure", (msg) => {
			const session = getSessionById(sessionId);

			const sessionWebhook = session?.webhookUrl;

			triggerWebhook(sessionWebhook, sessionId, "status", { msg });
		});
	});

	checkIfEventisEnabled("authenticated").then((_) => {
		client.on("authenticated", () => {
			const session = getSessionById(sessionId);

			const sessionWebhook = session?.webhookUrl;

			triggerWebhook(sessionWebhook, sessionId, "authenticated");
		});
	});

	checkIfEventisEnabled("call").then((_) => {
		client.on("call", async (call) => {
			const session = getSessionById(sessionId);

			const sessionWebhook = session?.webhookUrl;

			triggerWebhook(sessionWebhook, sessionId, "call", { call });
		});
	});

	checkIfEventisEnabled("change_state").then((_) => {
		client.on("change_state", (state) => {
			const session = getSessionById(sessionId);

			console.log(sessionId, state);

			const sessionWebhook = session?.webhookUrl;

			triggerWebhook(sessionWebhook, sessionId, "change_state", {
				state,
			});
		});
	});

	checkIfEventisEnabled("disconnected").then((_) => {
		client.on("disconnected", (reason) => {
			const session = getSessionById(sessionId);

			const sessionWebhook = session?.webhookUrl;

			triggerWebhook(sessionWebhook, sessionId, "disconnected", {
				reason,
			});
		});
	});

	// checkIfEventisEnabled("group_join").then((_) => {
	// 	client.on("group_join", (notification) => {
	// 		triggerWebhook(sessionWebhook, sessionId, "group_join", {
	// 			notification,
	// 		});
	// 	});
	// });

	// checkIfEventisEnabled("group_leave").then((_) => {
	// 	client.on("group_leave", (notification) => {
	// 		triggerWebhook(sessionWebhook, sessionId, "group_leave", {
	// 			notification,
	// 		});
	// 	});
	// });

	// checkIfEventisEnabled("group_update").then((_) => {
	// 	client.on("group_update", (notification) => {
	// 		triggerWebhook(sessionWebhook, sessionId, "group_update", {
	// 			notification,
	// 		});
	// 	});
	// });

	client.on("loading_screen", (percent, message) => {
		const session = getSessionById(sessionId);

		console.log(sessionId, { percent, message });

		const sessionWebhook = session?.webhookUrl;

		triggerWebhook(sessionWebhook, sessionId, "loading_screen", {
			percent,
			message,
		});
	});

	// checkIfEventisEnabled("media_uploaded").then((_) => {
	// 	client.on("media_uploaded", (message) => {
	// 		triggerWebhook(sessionWebhook, sessionId, "media_uploaded", {
	// 			message,
	// 		});
	// 	});
	// });

	// checkIfEventisEnabled("message").then((_) => {
	// 	client.on("message", async (message) => {
	// 		// /**
	// 		//  * Retirando o base64 no message
	// 		//  */
	// 		// delete message.body;

	// 		if (message?.id?.participant) {
	// 			return;
	// 		}

	// 		if (message.hasMedia) {
	// 			message.file = await message.downloadMedia();
	// 		}

	// 		if (message.fromMe) {
	// 			message.contact = await client.getContactById(message._data.to);

	// 			message.profilePicUrl = await client.getProfilePicUrl(
	// 				message._data.to
	// 			);
	// 		} else {
	// 			message.contact = await client.getContactById(
	// 				message._data.from
	// 			);

	// 			message.profilePicUrl = await client.getProfilePicUrl(
	// 				message._data.from
	// 			);
	// 		}

	// 		triggerWebhook(sessionWebhook, sessionId, "message", { message });

	// 		// if (message.hasMedia && message._data?.size < maxAttachmentSize) {
	// 		// 	// custom service event
	// 		// 	checkIfEventisEnabled("media").then((_) => {
	// 		// 		message
	// 		// 			.downloadMedia()
	// 		// 			.then((messageMedia) => {
	// 		// 				triggerWebhook(sessionWebhook, sessionId, "media", {
	// 		// 					messageMedia,
	// 		// 					message,
	// 		// 				});
	// 		// 			})
	// 		// 			.catch((e) => {
	// 		// 				console.log("Download media error:", e.message);
	// 		// 			});
	// 		// 	});
	// 		// }
	// 		if (setMessagesAsSeen) {
	// 			const chat = await message.getChat();
	// 			chat.sendSeen();
	// 		}
	// 	});
	// });

	checkIfEventisEnabled("message_ack").then((_) => {
		client.on("message_ack", async (message, ack) => {
			const session = getSessionById(sessionId);

			const sessionWebhook = session?.webhookUrl;

			triggerWebhook(sessionWebhook, sessionId, "message_ack", {
				message,
				ack,
			});
			// if (setMessagesAsSeen) {
			// 	const chat = await message.getChat();
			// 	chat.sendSeen();
			// }
		});
	});

	checkIfEventisEnabled("message_create").then((_) => {
		client.on("message_create", async (message) => {
			try {
				console.log(sessionId, message);
				const session = getSessionById(sessionId);

				const sessionWebhook = session?.webhookUrl;

				/**
				 * Ignorar mensagens do grupo
				 */
				if (message?.id?.participant) {
					return;
				}

				if (message.fromMe) {
					message.contact = await client.getContactById(
						message._data.to
					);

					message.profilePicUrl = await client.getProfilePicUrl(
						message._data.to
					);
				} else {
					message.contact = await client.getContactById(
						message._data.from
					);

					message.profilePicUrl = await client.getProfilePicUrl(
						message._data.from
					);
				}

				if (message.hasMedia) {
					const file = await message.downloadMedia();

					try {
						if (file) {
							const extension =
								mime.extension(file.mimetype) || "bin";

							const filename = uuid4() + "." + extension;

							await fs.promises.writeFile(
								`/usr/src/app/assets/${filename}`,
								file.data,
								"base64"
							);

							message.file = {
								mimetype: file.mimetype,
								extension,
								url: `https://api.whatsapp.maximizados.com.br/assets/${filename}`,
							};
						}
					} catch (error) {
						console.log("error", error);
					}
				}

				triggerWebhook(sessionWebhook, sessionId, "message_create", {
					message,
				});
			} catch (error) {
				console.log(sessionId, "message_create", error);
			}
			// if (setMessagesAsSeen) {
			// 	const chat = await message.getChat();
			// 	chat.sendSeen();
			// }
		});
	});

	checkIfEventisEnabled("message_reaction").then((_) => {
		client.on("message_reaction", (reaction) => {
			const session = getSessionById(sessionId);

			const sessionWebhook = session?.webhookUrl;

			/**
			 * Ignorar mensagens do grupo
			 */
			if (reaction?.id?.participant) {
				return;
			}

			triggerWebhook(sessionWebhook, sessionId, "message_reaction", {
				reaction,
			});
		});
	});

	checkIfEventisEnabled("message_revoke_everyone").then((_) => {
		client.on("message_revoke_everyone", async (after, before) => {
			const session = getSessionById(sessionId);

			const sessionWebhook = session?.webhookUrl;

			triggerWebhook(
				sessionWebhook,
				sessionId,
				"message_revoke_everyone",
				{ after, before }
			);
		});
	});

	client.on("qr", (qr) => {
		client.qr = qr;

		// inject qr code into session
		// checkIfEventisEnabled("qr").then((_) => {
		// 	triggerWebhook(sessionWebhook, sessionId, "qr", { qr });
		// });
	});

	checkIfEventisEnabled("ready").then((_) => {
		client.on("ready", () => {
			const session = getSessionById(sessionId);

			const sessionWebhook = session?.webhookUrl;

			triggerWebhook(sessionWebhook, sessionId, "ready");
		});
	});

	// checkIfEventisEnabled("contact_changed").then((_) => {
	// 	client.on(
	// 		"contact_changed",
	// 		async (message, oldId, newId, isContact) => {
	// 			/**
	// 			 * Ignorar mensagens do grupo
	// 			 */
	// 			if (message?.id?.participant) {
	// 				return;
	// 			}

	// 			triggerWebhook(sessionWebhook, sessionId, "contact_changed", {
	// 				message,
	// 				oldId,
	// 				newId,
	// 				isContact,
	// 			});
	// 		}
	// 	);
	// });
};

// Function to check if folder is writeable
const deleteSessionFolder = async (sessionId) => {
	try {
		const targetDirPath = `${sessionFolderPath}/session-${sessionId}/`;
		const resolvedTargetDirPath = await fs.promises.realpath(targetDirPath);
		const resolvedSessionPath = await fs.promises.realpath(
			sessionFolderPath
		);
		// Check if the target directory path is a subdirectory of the sessions folder path
		if (!resolvedTargetDirPath.startsWith(resolvedSessionPath)) {
			throw new Error("Invalid path");
		}
		await fs.promises.rm(targetDirPath, { recursive: true, force: true });
	} catch (error) {
		console.log("Folder deletion error", error);
		throw error;
	}
};

// Function to delete client session
const deleteSession = async (sessionId, validation) => {
	try {
		const client = sessions.get(sessionId);
		if (!client) {
			return;
		}
		client.pupPage.removeAllListeners("close");
		client.pupPage.removeAllListeners("error");
		if (validation.success) {
			// Client Connected, request logout
			console.log(`Logging out session ${sessionId}`);
			await client.logout();
		} else if (validation.message === "session_not_connected") {
			// Client not Connected, request destroy
			console.log(`Destroying session ${sessionId}`);
			await client.destroy();
		}

		// Wait for client.pupBrowser to be disconnected before deleting the folder
		while (client.pupBrowser.isConnected()) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		await deleteSessionFolder(sessionId);

		removeSession(sessionId);

		sessions.delete(sessionId);
	} catch (error) {
		console.log(error);
		throw error;
	}
};

// Function to handle session flush
const flushSessions = async (deleteOnlyInactive) => {
	try {
		// Read the contents of the sessions folder
		const files = await fs.promises.readdir(sessionFolderPath);
		// Iterate through the files in the parent folder
		for (const file of files) {
			// Use regular expression to extract the string from the folder name
			const match = file.match(/^session-(.+)$/);
			if (match && match[1]) {
				const sessionId = match[1];
				const validation = await validateSession(sessionId);
				if (!deleteOnlyInactive || !validation.success) {
					await deleteSession(sessionId, validation);
				}
			}
		}
	} catch (error) {
		console.log(error);
		throw error;
	}
};

module.exports = {
	sessions,
	setupSession,
	restoreSessions,
	validateSession,
	deleteSession,
	flushSessions,
};
