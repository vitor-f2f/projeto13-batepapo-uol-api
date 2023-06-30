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

app.listen(5000, () => {
    console.log(`Usando porta 5000`);
});

// conexão e criação do db
const mongoClient = new MongoClient(process.env.DATABASE_URL);
let db;

mongoClient.connect((error) => {
    if (error) {
        console.log(`Falha na conexão com MongoDB: ${error}`);
        process.exit(1);
    }

    console.log("Conectado a MongoDB");
    db = mongoClient.db();

    // collection de participants com validação joi
    const participants = db.collection("participants");
    const participantSchema = joi.object({
        name: joi.string().min(1).required(),
    });

    const messages = db.collection("messages");
});

// requisiçoes
app.post("/participants", async (req, res) => {
    try {
        const { error } = participantSchema.validate(req.body);
        if (error) {
            return res.status(422).send("Erro de validação");
        }

        const { name } = req.body;

        const nameExists = await participants.findOne({ name });

        if (nameExists) {
            return res.status(409).send("Usuario ja existe");
        }

        const lastStatus = Date.now();

        const participant = { name, lastStatus };
        await participants.insertOne(participant);

        const message = {
            from: name,
            to: "Todos",
            text: "entra na sala...",
            type: "status",
            time: dayjs().format("HH:mm:ss"),
        };
        await messages.insertOne(message);

        console.log("Usuario salvo com sucesso");
        return res.sendStatus(201);
    } catch (error) {
        return res.sendStatus(500);
    }
});
