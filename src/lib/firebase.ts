import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { SupplyAlertRecord, SupplyAlertStatus } from '../core/supplyAlertEngine';

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.messages.readonly',
  'https://www.googleapis.com/auth/chat.messages.create',
  'https://www.googleapis.com/auth/contacts.readonly',
];
for (const scope of WORKSPACE_SCOPES) {
  googleProvider.addScope(scope);
}

let inMemoryOAuthToken: string | null = null;

export function getWorkspaceAccessToken(): string | null {
  return inMemoryOAuthToken;
}

export async function signInWithGoogleWorkspace(): Promise<{
  user: User;
  accessToken: string | null;
}> {
  const result = await signInWithPopup(auth, googleProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (credential?.accessToken) {
    inMemoryOAuthToken = credential.accessToken;
  }
  return { user: result.user, accessToken: inMemoryOAuthToken };
}

export async function signOutAccount(): Promise<void> {
  inMemoryOAuthToken = null;
  await signOut(auth);
}

export function subscribeAuthChanges(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}

export function handleFirestoreError(
  error: unknown,
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write',
  path: string | null
) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    uid: auth.currentUser?.uid ?? null,
  };
  console.warn('Firestore operation notice:', errInfo);
  return errInfo;
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore appears offline or unreachable.');
      return false;
    }
    return true;
  }
}

export async function syncFirestoreDocument(
  collectionPath: string,
  docId: string,
  data: DocumentData
): Promise<boolean> {
  if (!auth.currentUser) return false;
  try {
    await setDoc(
      doc(db, collectionPath, docId),
      {
        ...data,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  } catch (error) {
    handleFirestoreError(error, 'write', `${collectionPath}/${docId}`);
    return false;
  }
}

export async function syncSupplyAlertFirestore(alert: SupplyAlertRecord): Promise<boolean> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return false;
  const alertId = alert.alertCode.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  if (alertId.length < 3) return false;
  const ref = doc(db, 'supplyAlerts', alertId);

  try {
    const snap = await getDoc(ref);
    const basePayload = {
      stockQty: Math.max(0, Math.min(1000000, Math.floor(alert.stockQty))),
      reorderThreshold: Math.max(1, Math.min(1000000, Math.floor(alert.reorderThreshold))),
      criticalThreshold: Math.max(0, Math.min(1000000, Math.floor(alert.criticalThreshold))),
      severity: alert.severity,
      status: alert.status,
      triggeredBy: alert.triggeredBy.slice(0, 64),
      updatedAt: serverTimestamp(),
    };

    if (!snap.exists()) {
      if (alert.status !== 'active') return false;
      await setDoc(ref, {
        alertId,
        ownerUid: user.uid,
        sku: alert.sku.slice(0, 32),
        productName: alert.productName.slice(0, 140),
        supplierName: alert.supplierName.slice(0, 120),
        ...basePayload,
        createdAt: serverTimestamp(),
      });
    } else {
      const existingData = snap.data();
      if (existingData?.status === 'resolved') return true;
      await updateDoc(ref, basePayload);
    }
    return true;
  } catch (error) {
    handleFirestoreError(error, 'write', `supplyAlerts/${alertId}`);
    return false;
  }
}

export function subscribeSupplyAlertsFirestore(
  uid: string,
  onAlerts: (alerts: Array<{ alertId: string; status: SupplyAlertStatus; severity: 'low' | 'critical'; stockQty: number; reorderThreshold: number }>) => void
): () => void {
  if (!uid) return () => {};
  const q = query(collection(db, 'supplyAlerts'), where('ownerUid', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          alertId: String(data.alertId || d.id),
          status: (data.status as SupplyAlertStatus) || 'active',
          severity: data.severity === 'critical' ? ('critical' as const) : ('low' as const),
          stockQty: Number(data.stockQty ?? 0),
          reorderThreshold: Number(data.reorderThreshold ?? 25),
        };
      });
      onAlerts(items);
    },
    (error) => {
      handleFirestoreError(error, 'list', 'supplyAlerts');
    }
  );
}

