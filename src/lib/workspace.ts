import { getWorkspaceAccessToken } from './firebase';

export interface WorkspaceDriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
}

export interface WorkspaceEmailSummary {
  id: string;
  subject: string;
  from: string;
  snippet: string;
}

export interface WorkspaceChatSpace {
  name: string;
  displayName: string;
  type: string;
}

export interface WorkspaceContact {
  name: string;
  email: string;
  phone: string;
}

function requireToken(): string {
  const token = getWorkspaceAccessToken();
  if (!token) {
    throw new Error('Sign in with Google Workspace first to authorize Drive, Gmail, Docs, Chat, and Contacts.');
  }
  return token;
}

export async function fetchDriveFiles(): Promise<WorkspaceDriveFile[]> {
  const token = requireToken();
  const res = await fetch(
    'https://www.googleapis.com/drive/v3/files?pageSize=6&fields=files(id,name,mimeType,modifiedTime)&orderBy=modifiedTime%20desc',
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Drive API returned ${res.status}`);
  const data = (await res.json()) as { files?: WorkspaceDriveFile[] };
  return data.files ?? [];
}

export async function createCareSummaryDoc(title: string, bodyText: string): Promise<{ documentId: string; url: string }> {
  const token = requireToken();
  const createRes = await fetch('https://docs.googleapis.com/v1/documents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  });
  if (!createRes.ok) throw new Error(`Docs API create failed (${createRes.status})`);
  const created = (await createRes.json()) as { documentId: string };

  const updateRes = await fetch(`https://docs.googleapis.com/v1/documents/${created.documentId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [{ insertText: { location: { index: 1 }, text: bodyText } }],
    }),
  });
  if (!updateRes.ok) throw new Error(`Docs batchUpdate failed (${updateRes.status})`);

  return {
    documentId: created.documentId,
    url: `https://docs.google.com/document/d/${created.documentId}/edit`,
  };
}

export async function fetchRecentEmails(): Promise<WorkspaceEmailSummary[]> {
  const token = requireToken();
  const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) throw new Error(`Gmail list failed (${listRes.status})`);
  const listData = (await listRes.json()) as { messages?: Array<{ id: string }> };
  const ids = (listData.messages ?? []).slice(0, 4);

  const details = await Promise.all(
    ids.map(async ({ id }) => {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!msgRes.ok) return null;
      const msgData = (await msgRes.json()) as {
        id: string;
        snippet?: string;
        payload?: { headers?: Array<{ name: string; value: string }> };
      };
      const headers = msgData.payload?.headers ?? [];
      const subject = headers.find((h) => h.name === 'Subject')?.value || '(No subject)';
      const from = headers.find((h) => h.name === 'From')?.value || 'Unknown sender';
      return { id: msgData.id, subject, from, snippet: msgData.snippet || '' };
    })
  );

  return details.filter((d): d is WorkspaceEmailSummary => d !== null);
}

export async function sendCareEmail(to: string, subject: string, body: string): Promise<{ id: string }> {
  const token = requireToken();
  const rawEmail = [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8', '', body].join('\r\n');
  const encoded = btoa(unescape(encodeURIComponent(rawEmail)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encoded }),
  });
  if (!res.ok) throw new Error(`Gmail send failed (${res.status})`);
  return (await res.json()) as { id: string };
}

export async function fetchChatSpaces(): Promise<{ spaces: WorkspaceChatSpace[]; setupNotice?: string }> {
  const token = requireToken();
  const res = await fetch('https://chat.googleapis.com/v1/spaces?pageSize=6', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) {
    return {
      spaces: [],
      setupNotice:
        'Google Chat App configuration required for this workspace project (gen-lang-client-0776912993).',
    };
  }
  if (!res.ok) throw new Error(`Chat API returned ${res.status}`);
  const data = (await res.json()) as { spaces?: WorkspaceChatSpace[] };
  return { spaces: data.spaces ?? [] };
}

export async function postChatMessage(spaceName: string, text: string): Promise<void> {
  const token = requireToken();
  const res = await fetch(`https://chat.googleapis.com/v1/${spaceName}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Chat message send failed (${res.status})`);
}

export async function fetchContacts(): Promise<WorkspaceContact[]> {
  const token = requireToken();
  const res = await fetch(
    'https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers&pageSize=6',
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Contacts API returned ${res.status}`);
  const data = (await res.json()) as {
    connections?: Array<{
      names?: Array<{ displayName?: string }>;
      emailAddresses?: Array<{ value?: string }>;
      phoneNumbers?: Array<{ value?: string }>;
    }>;
  };
  return (data.connections ?? []).map((person) => ({
    name: person.names?.[0]?.displayName || 'Contact',
    email: person.emailAddresses?.[0]?.value || '',
    phone: person.phoneNumbers?.[0]?.value || '',
  }));
}
