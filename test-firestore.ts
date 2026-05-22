import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";
import fs from "fs";

const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);

async function testPayload() {
    try {
        await setDoc(doc(db, "test", "testDoc"), {
            testArray: [null, "string"],
            testNull: null,
            testNested: { field: null, val: "123" }
        });
        console.log("Success with nulls");
    } catch(e: any) {
        console.error("Payload error:", e.message);
    }
}
testPayload();

