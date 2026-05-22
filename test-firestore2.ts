import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";

try {
  const db = { type: 'firestore' }; // mock
  // let's not mock db to test actual payload error
} catch(e) {}

