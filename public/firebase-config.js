// Firebase v10 Modular Web SDK Configuration
// Matches backend credentials from app/google-services.json
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, setDoc, getDoc, query, where } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-functions.js";

const firebaseConfig = {
    apiKey: "AIzaSyB7hIR3vBW3zf-j2ZEKgo9vNVzxP2F3nHY",
    authDomain: "shibanya-1625.firebaseapp.com",
    projectId: "shibanya-1625",
    storageBucket: "shibanya-1625.firebasestorage.app",
    messagingSenderId: "655692823133",
    appId: "1:655692823133:web:bff8df28e420c0f300ebb4"
};

// Initialize Firebase App
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);

export {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    signInAnonymously,
    collection,
    getDocs,
    doc,
    setDoc,
    getDoc,
    query,
    where,
    getFunctions,
    httpsCallable
};
