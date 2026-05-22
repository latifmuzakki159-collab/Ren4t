import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const validateConnection = async () => {
  try {
    // Just a dummy ping to test the connection.
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    // Ignore permissions errors, it just means connection works but was denied by rules
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
};
