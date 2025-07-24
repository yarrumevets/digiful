import { MongoClient } from "mongodb";

let client: MongoClient | undefined;
let mongoClientPromise: Promise<MongoClient>;

client = new MongoClient("" + process.env.MONGODB_URL);
mongoClientPromise = client.connect();

export { mongoClientPromise };
