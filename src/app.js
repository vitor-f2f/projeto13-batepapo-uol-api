import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dayjs from "dayjs";
import joi from "joi";
import dotenv from "dotenv";
import { stripHtml } from "string-strip-html";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// conexão e criação do db
const client = new MongoClient(process.env.DATABASE_URL);

client.connect((error) => {
    if (error) {
        console.log(`Falha na conexão com MongoDB: ${error}`);
        process.exit(1);
    }

    console.log("Conectado a MongoDB");
});

let db = client.db();

const participantSchema = joi.object({
    name: joi.string().min(1).required(),
});

const messageSchema = joi.object({
    to: joi.string().min(1).required(),
    text: joi.string().min(1).required(),
    type: joi.string().valid("message", "private_message").required(),
});

// requisiçoes
app.post("/participants", async (req, res) => {
    let participant = req.body;
    if (typeof participant.name == "string") {
        participant.name = stripHtml(participant.name).result.trim();
    }
    const { error } = participantSchema.validate(participant, {
        abortEarly: false,
    });
    if (error) {
        return res.status(422).send("Erro de validação do usuario");
    }

    try {
        const nameExists = await db
            .collection("participants")
            .findOne({ name: participant.name });

        if (nameExists) {
            return res.status(409).send("Usuario ja existe");
        }

        const lastStatus = Date.now();
        const partObj = {
            name: participant.name,
            lastStatus: lastStatus,
        };
        await db.collection("participants").insertOne(partObj);

        const msgTime = dayjs().format("HH:mm:ss");
        const message = {
            from: participant.name,
            to: "Todos",
            text: "entra na sala...",
            type: "status",
            time: msgTime,
        };
        await db.collection("messages").insertOne(message);

        console.log(`Usuario ${participant.name} salvo com sucesso`);
        return res.sendStatus(201);
    } catch (error) {
        return res.status(500).send("Erro");
    }
});

app.get("/participants", async (req, res) => {
    try {
        const participants = await db
            .collection("participants")
            .find()
            .toArray();
        return res.json(participants);
    } catch (err) {
        return res.sendStatus(500);
    }
});

app.post("/messages", async (req, res) => {
    try {
        let message = req.body;
        let from = req.headers.user;

        if (!from) {
            throw new Error("Header incorreto");
        }

        const userFrom = await db
            .collection("participants")
            .findOne({ name: from });
        if (!userFrom) {
            throw new Error("Usuário não encontrado");
        }

        const { error: validationError } = messageSchema.validate(message, {
            abortEarly: false,
        });

        if (validationError) {
            throw new Error("Mensagem inválida");
        }

        // strip-html
        from = stripHtml(from).result.trim();
        message.to = stripHtml(message.to).result.trim();
        message.text = stripHtml(message.text).result.trim();
        message.type = stripHtml(message.type).result.trim();

        const msgTime = dayjs().format("HH:mm:ss");
        const messageObj = {
            from,
            to: message.to,
            text: message.text,
            type: message.type,
            time: msgTime,
        };
        await db.collection("messages").insertOne(messageObj);

        console.log("Mensagem enviada com sucesso");
        return res.sendStatus(201);
    } catch (error) {
        return res.status(422).send(error.message);
    }
});

app.get("/messages", async (req, res) => {
    const { user } = req.headers;
    let limit = parseInt(req.query.limit);

    if (req.query.limit && (isNaN(limit) || limit <= 0)) {
        return res.status(422).send("Limite invalido");
    }

    try {
        let query = {
            $or: [{ to: "Todos" }, { to: user }, { from: user }],
        };
        let messages;
        if (limit) {
            messages = await db
                .collection("messages")
                .find(query)
                .sort({ _id: -1 })
                .limit(limit)
                .toArray();
            messages.reverse();
        } else {
            messages = await db.collection("messages").find(query).toArray();
        }
        return res.status(200).json(messages);
    } catch (err) {
        return res.sendStatus(500);
    }
});

app.post("/status", async (req, res) => {
    const userName = req.headers.user;

    if (!userName) {
        return res.status(404).send("Header invalido");
    }

    try {
        const user = await db
            .collection("participants")
            .findOne({ name: userName });
        const update = { $set: { lastStatus: Date.now() } };
        if (user) {
            const result = await db
                .collection("participants")
                .updateOne({ name: userName }, update);
            return res.sendStatus(200);
        } else {
            return res.status(404).send("Usuario não foi encontrado");
        }
    } catch (error) {
        return res.status(500).send("Erro ao atualizar status");
    }
});

const checkInactive = async () => {
    try {
        const inactiveUsers = await db
            .collection("participants")
            .find({ lastStatus: { $lt: Date.now() - 10000 } })
            .toArray();
        if (inactiveUsers.length === 0) {
            return;
        }

        const currentTime = dayjs().format("HH:mm:ss");

        await db.collection("participants").deleteMany({
            _id: { $in: inactiveUsers.map((user) => user._id) },
        });

        const statusMessages = inactiveUsers.map((user) => {
            console.log(`Usuario removido: ${user.name}`);
            return {
                from: user.name,
                to: "Todos",
                text: "sai da sala...",
                type: "status",
                time: currentTime,
            };
        });

        await db.collection("messages").insertMany(statusMessages);
    } catch {
        return console.log("Erro ao checar usuarios inativos");
    }
};

setInterval(checkInactive, 15000);

app.delete("/messages/:id", async (req, res) => {
    const id = req.params["id"];
    const { user } = req.headers;

    try {
        const findMessage = await db
            .collection("messages")
            .findOne({ _id: new ObjectId(id) });

        if (findMessage == null) {
            return res.status(404).send("Mensagem não foi encontrada");
        }

        if (findMessage.from !== user) {
            return res.status(401).send("Você não tem permissão para isso");
        }

        const deleteMsg = await db
            .collection("messages")
            .deleteOne({ _id: new ObjectId(id) });

        return res.sendStatus(200);
    } catch (error) {
        return res.status(500).send("Erro ao apagar mensagem");
    }
});

app.put("/messages/:id", async (req, res) => {
    const id = req.params["id"];
    const { user } = req.headers;
    const message = req.body;

    const { error: validationError } = messageSchema.validate(message, {
        abortEarly: false,
    });
    if (validationError) {
        return res.status(422).send("Erro de validação");
    }

    try {
        const findMessage = await db
            .collection("messages")
            .findOne({ _id: new ObjectId(id) });

        if (findMessage == null) {
            return res.status(404).send("Mensagem não foi encontrada");
        }

        console.log(findMessage);

        if (findMessage.from !== user) {
            return res.send(401).send("Você não tem permissão para isso");
        }

        const update = {
            $set: { to: message.to, text: message.text, type: message.type },
        };

        const result = await db
            .collection("messages")
            .updateOne({ _id: id }, update);

        return res.sendStatus(200);
    } catch (error) {
        return res.status(500).send("Erro ao atualizar mensagem");
    }
});

const PORT = 5000;
app.listen(PORT, () => {
    console.log(`Usando porta ${PORT}`);
});
