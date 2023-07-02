import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import dayjs from "dayjs";
import joi from "joi";
import dotenv from "dotenv";

const app = express();
app.use(cors());
app.use(express.json());
dotenv.config();

const PORT = 5000;
app.listen(PORT, () => {
    console.log(`Usando porta ${PORT}`);
});

// conexão e criação do db
const client = new MongoClient(process.env.DATABASE_URL);
let db;

client.connect((error) => {
    if (error) {
        console.log(`Falha na conexão com MongoDB: ${error}`);
        process.exit(1);
    }

    console.log("Conectado a MongoDB");
    db = client.db();
});

const participantSchema = joi.object({
    name: joi.string().min(1).required(),
});

// requisiçoes
app.post("/participants", async (req, res) => {
    const participant = req.body;
    const { error } = participantSchema.validate(participant, {
        abortEarly: false,
    });
    if (error) {
        return res.status(422).send("Erro de validação");
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

        console.log("Usuario salvo com sucesso");
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
