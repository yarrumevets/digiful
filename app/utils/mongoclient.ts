import { MongoClient } from "mongodb";

let client: MongoClient | undefined;
let mongoClientPromise: Promise<MongoClient>;

const uri = "mongodb://localhost:27017";

client = new MongoClient(uri);
mongoClientPromise = client.connect();

export { mongoClientPromise };
