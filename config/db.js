import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const url = process.env.URL_DB;

export default async function ConnectToDB() {
    try {
        await mongoose.connect(url);
        console.log('Connected to DB');
    } catch (error) {
        console.error('Error connecting to DB:', error);
    }
}
