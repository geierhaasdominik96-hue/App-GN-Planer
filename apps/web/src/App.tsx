import type {
  BatchCreateStudentsResponse,
  ChangePasswordResponse,
  CreateInvitationResponse,
  CreateDemoDataResponse,
  CreateStudentResponse,
  CreateTeacherResponse,
  CreateTeamResponse,
  DeleteDemoDataResponse,
  DemoCredential,
  DemoDataStatusResponse,
  MeResponse,
  PublicInvitationResponse,
  RedeemInvitationResponse,
  ResetStudentPasswordResponse,
  StudentManagementResponse,
  StudentOverviewResponse,
  SystemStatusResponse,
  TeacherOverviewResponse
} from "@gn-planer/contracts";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { apiRequest, type LoadState } from "./api.js";
import { authClient } from "./auth-client.js";
import { CoachView, PlanningView, StudentBookingView } from "./PlannerViews.js";

type TeacherView = "overview" | "management" | "planning" | "coach" | "settings";
type StudentView = "overview" | "booking" | "settings";

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  document.execCommand("copy");
  field.remove();
}

function csvCell(value: string) {
  const protectedValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

function downloadCredentialList(result: BatchCreateStudentsResponse) {
  const rows = [
    ["Name", "Schul-ID", "Erstkennwort", "Team"],
    ...result.accounts.map((account) => [
      account.displayName,
      account.loginId,
      account.initialPassword,
      result.teamName
    ])
  ];
  const csv = `\uFEFFsep=;\r\n${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeTeamName = result.teamName.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, "-");
  link.href = url;
  link.download = `Zugangsliste-${safeTeamName}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadDemoCredentialList(credentials: DemoCredential[]) {
  const rows = [
    ["Name", "Team", "Schul-ID", "Erstkennwort"],
    ...credentials.map((credential) => [
      credential.displayName,
      credential.teamName,
      credential.loginId,
      credential.initialPassword
    ])
  ];
  const csv = `\uFEFFsep=;\r\n${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "Demo-Zugangsdaten.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function demoCredentialText(credentials: DemoCredential[]) {
  return [
    "Name\tTeam\tSchul-ID\tErstkennwort",
    ...credentials.map((credential) => [
      credential.displayName,
      credential.teamName,
      credential.loginId,
      credential.initialPassword
    ].join("\t"))
  ].join("\n");
}

function printCredential(name: string, loginId: string, password: string) {
  const printWindow = window.open("", "_blank", "width=620,height=720");
  if (!printWindow) return;
  const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
  printWindow.document.write(`<!doctype html><html lang="de"><head><title>GN-Planer Zugang</title><style>body{font:18px system-ui;padding:48px;color:#1d2925}article{border:2px solid #294d3b;border-radius:18px;padding:32px}h1{margin-top:0}.value{font:700 25px ui-monospace,monospace;background:#eef3ef;padding:12px;border-radius:8px}small{color:#66736b}@media print{button{display:none}}</style></head><body><article><small>Persönliche Zugangsdaten · GN-Planer</small><h1>${escape(name)}</h1><p>Schul-ID</p><p class="value">${escape(loginId)}</p><p>Erstkennwort</p><p class="value">${escape(password)}</p><p><small>Bitte beim ersten Anmelden ein persönliches Passwort festlegen und dieses Blatt sicher aufbewahren.</small></p><button onclick="window.print()">Drucken</button></article></body></html>`);
  printWindow.document.close();
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">G</span>
      <div>
        <strong>GN-Planer</strong>
        <span>Gelingensnachweise im Blick</span>
      </div>
    </div>
  );
}

function Login() {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setPending(true);
    const result = await authClient.signIn.username({ username: loginId, password });
    setPending(false);
    if (result.error) setMessage("ID oder Passwort stimmen nicht.");
  }

  return (
    <main className="login-layout">
      <section className="login-intro">
        <Brand />
        <p className="eyebrow">Schulinterne Terminplanung</p>
        <h1>Planen, schreiben, abhaken.</h1>
        <p className="intro-copy">
          Schüler*innen buchen ihren passenden Termin. Lerncoaches sehen sofort,
          was geplant, offen oder bereits erledigt ist.
        </p>
        <div className="feature-row">
          <span>Klare Termine</span>
          <span>Sichere Konten</span>
          <span>Gemeinsamer Überblick</span>
        </div>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-card">
          <p className="eyebrow">Willkommen zurück</p>
          <h2 id="login-title">Anmelden</h2>
          <p className="muted">Nutze die ID, die du von deiner Schule bekommen hast.</p>
          <form onSubmit={submit}>
            <label>
              Schul-ID
              <input
                autoComplete="username"
                autoFocus
                value={loginId}
                onChange={(event) => setLoginId(event.target.value)}
                placeholder="z. B. maxm"
                required
              />
            </label>
            <label>
              Passwort
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {message && <p className="form-error" role="alert">{message}</p>}
            <button className="primary-button" disabled={pending} type="submit">
              {pending ? "Anmeldung läuft …" : "Anmelden"}
            </button>
          </form>
          <p className="privacy-note">Keine öffentliche Registrierung. Konten legt die Schule an.</p>
        </div>
      </section>
    </main>
  );
}

function InvitationRegistration({ token }: { token: string }) {
  const [invitation, setInvitation] = useState<LoadState<PublicInvitationResponse>>({ status: "loading" });
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [created, setCreated] = useState<RedeemInvitationResponse | null>(null);

  useEffect(() => {
    void apiRequest<PublicInvitationResponse>(`/api/invitations/${encodeURIComponent(token)}`)
      .then((data) => setInvitation({ status: "ready", data }))
      .catch((error: unknown) =>
        setInvitation({ status: "error", message: error instanceof Error ? error.message : "Einladung ist ungültig." })
      );
  }, [token]);

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const result = await apiRequest<RedeemInvitationResponse>(
        `/api/invitations/${encodeURIComponent(token)}/redeem`,
        {
          method: "POST",
          body: JSON.stringify({ displayName, password, confirmPassword })
        }
      );
      setCreated(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Konto konnte nicht erstellt werden.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="invitation-page">
      <section className="invitation-panel">
        <Brand />
        {invitation.status === "loading" && <p className="status-box">Einladung wird geprüft …</p>}
        {invitation.status === "error" && (
          <div className="invitation-result error-result">
            <span className="result-icon">!</span>
            <h1>Einladung nicht verfügbar</h1>
            <p>{invitation.message}</p>
            <a className="secondary-button link-button" href="/">Zur Anmeldung</a>
          </div>
        )}
        {invitation.status === "ready" && !created && (
          <div className="invite-registration-card">
            <p className="eyebrow">Einladung für {invitation.data.teamName}</p>
            <h1>Dein Konto anlegen</h1>
            <p className="muted">Gib deinen vollständigen Namen ein und wähle ein persönliches Passwort.</p>
            <form onSubmit={register}>
              <label>
                Vor- und Nachname
                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
              </label>
              <label>
                Passwort
                <input autoComplete="new-password" minLength={10} type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
              </label>
              <label>
                Passwort wiederholen
                <input autoComplete="new-password" minLength={10} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
              </label>
              {message && <p className="form-error" role="alert">{message}</p>}
              <button className="primary-button" disabled={pending} type="submit">
                {pending ? "Konto wird erstellt …" : "Konto erstellen"}
              </button>
            </form>
            <p className="invite-expiry">Gültig bis {new Date(invitation.data.expiresAt).toLocaleString("de-DE")}.</p>
          </div>
        )}
        {created && (
          <div className="invitation-result">
            <span className="result-icon success-icon">✓</span>
            <p className="eyebrow">Konto erfolgreich angelegt</p>
            <h1>Willkommen, {created.displayName}</h1>
            <p>Deine Schul-ID lautet:</p>
            <strong className="created-login-id">{created.loginId}</strong>
            <p className="muted">Merke dir diese ID. Zusammen mit deinem gewählten Passwort brauchst du sie zur Anmeldung.</p>
            <a className="primary-button link-button" href="/">Jetzt anmelden</a>
          </div>
        )}
      </section>
    </main>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <article className="stat-card">
      <span className={`stat-dot ${accent}`} />
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}

function TeacherOverview({ me, onManage, onCoach }: { me: MeResponse; onManage: () => void; onCoach: () => void }) {
  const [state, setState] = useState<LoadState<TeacherOverviewResponse>>({ status: "loading" });

  useEffect(() => {
    void apiRequest<TeacherOverviewResponse>("/api/teacher/overview")
      .then((data) => setState({ status: "ready", data }))
      .catch((error: unknown) =>
        setState({ status: "error", message: error instanceof Error ? error.message : "Fehler" })
      );
  }, []);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Lehrkraft-Übersicht</p>
          <h1>Guten Tag, {me.profile.displayName}</h1>
          <p>Konten, Teams und der aktuelle Planungsstand auf einen Blick.</p>
        </div>
        {(me.profile.canManageAccounts || me.profile.canManageTeams) && (
          <button className="primary-button compact" onClick={onManage}>Schüler*innen verwalten</button>
        )}
      </div>
      {state.status === "loading" && <p className="status-box">Übersicht wird geladen …</p>}
      {state.status === "error" && <p className="status-box error">{state.message}</p>}
      {state.status === "ready" && (
        <div className="stat-grid">
          <StatCard label="aktive Teams" value={state.data.counts.teams} accent="green" />
          <StatCard label="Schüler*innen" value={state.data.counts.students} accent="blue" />
          <StatCard label="geplante GNs" value={state.data.counts.upcomingBookings} accent="orange" />
          <StatCard label="kommende Termine" value={state.data.counts.upcomingAppointments} accent="purple" />
        </div>
      )}
      <section className="content-card next-steps">
        <div>
          <p className="eyebrow">Schnellstart</p>
          <h2>{me.profile.canManageAccounts || me.profile.canManageTeams ? "Die Schule einrichten" : "Deine Teams begleiten"}</h2>
          <p>{me.profile.canManageAccounts || me.profile.canManageTeams ? "Lege Teams an und verwalte anschließend die Schülerkonten." : "Prüfe, welche Gelingensnachweise bereits geplant oder erledigt sind."}</p>
        </div>
        <button className="secondary-button" onClick={me.profile.canManageAccounts || me.profile.canManageTeams ? onManage : onCoach}>{me.profile.canManageAccounts || me.profile.canManageTeams ? "Zur Verwaltung" : "Zur Lerncoach-Übersicht"}</button>
      </section>
    </>
  );
}

function InvitationLinkCard({ created }: { created: CreateInvitationResponse }) {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inviteUrl = `${window.location.origin}/invite/${created.token}`;
  const isLocalAddress = ["localhost", "127.0.0.1"].includes(window.location.hostname);

  useEffect(() => {
    void QRCode.toDataURL(inviteUrl, {
      width: 360,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#183328", light: "#ffffff" }
    })
      .then(setQrCode)
      .catch(() => setMessage("Der QR-Code konnte nicht erstellt werden. Der Link kann weiterhin kopiert werden."));
  }, [inviteUrl]);

  async function copyLink() {
    await copyText(inviteUrl);
    setMessage("Einladungslink wurde kopiert.");
  }

  async function shareLink() {
    if (!navigator.share) {
      await copyLink();
      return;
    }
    try {
      await navigator.share({
        title: `Einladung zum GN-Planer – ${created.invitation.teamName}`,
        text: `Lege dein Schülerkonto für ${created.invitation.teamName} an.`,
        url: inviteUrl
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      await copyLink();
    }
  }

  return (
    <section className="invite-output" aria-live="polite">
      <div className="qr-wrap">
        {qrCode ? <img alt={`QR-Code für die Einladung zu ${created.invitation.teamName}`} src={qrCode} /> : <span>QR-Code wird erstellt …</span>}
      </div>
      <div className="invite-output-copy">
        <p className="eyebrow">Einladung bereit</p>
        <h2>{created.invitation.teamName}</h2>
        <p>Schüler*innen scannen den QR-Code oder öffnen den Link und wählen ihr eigenes Passwort.</p>
        <div className="invite-url"><span>{inviteUrl}</span></div>
        {isLocalAddress && (
          <p className="network-warning">
            Dieser Link gilt nur auf diesem Rechner. Für Tablets öffnest du den Planer zuerst über seine Netzwerkadresse und erzeugst den Link dort erneut.
          </p>
        )}
        <div className="button-row">
          <button className="primary-button compact" onClick={() => void copyLink()}>Link kopieren</button>
          <button className="secondary-button" onClick={() => void shareLink()}>Teilen</button>
        </div>
        {message && <p className="form-success">{message}</p>}
        <p className="one-time-note">Der vollständige Link wird aus Sicherheitsgründen nur jetzt angezeigt.</p>
      </div>
    </section>
  );
}

function EditableTeamCard({ team, selected, onSelect, onReload, onMessage }: {
  team: StudentManagementResponse["teams"][number];
  selected: boolean;
  onSelect: () => void;
  onReload: () => void;
  onMessage: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.name);
  async function save() {
    try {
      await apiRequest(`/api/teacher/teams/${team.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      setEditing(false);
      onMessage("Teamname wurde gespeichert.");
      onReload();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Team konnte nicht geändert werden.");
    }
  }
  return (
    <article className={`team-card ${selected ? "selected" : ""}`}>
      {editing ? <input aria-label="Teamname" value={name} onChange={(event) => setName(event.target.value)} /> : <button className="team-select-button" onClick={onSelect}><strong>{team.name}</strong><span>{team.studentCount} Schüler*innen</span></button>}
      <button className="text-button" onClick={() => editing ? void save() : setEditing(true)}>{editing ? "Speichern" : "Umbenennen"}</button>
    </article>
  );
}

function EditableStudentRow({ student, teams, allowNoTeam, onReload, onMessage, onCredentials }: {
  student: StudentManagementResponse["students"][number];
  teams: StudentManagementResponse["teams"];
  allowNoTeam: boolean;
  onReload: () => void;
  onMessage: (message: string) => void;
  onCredentials: (credentials: CreateStudentResponse) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(student.displayName);
  const [loginId, setLoginId] = useState(student.loginId);
  const [teamId, setTeamId] = useState(student.teamId ?? "");
  const [active, setActive] = useState(student.active);
  async function save() {
    try {
      await apiRequest(`/api/teacher/students/${student.id}`, { method: "PATCH", body: JSON.stringify({ displayName, loginId, teamId: teamId || null, active }) });
      setEditing(false);
      onMessage("Schülerkonto wurde aktualisiert.");
      onReload();
    } catch (error) { onMessage(error instanceof Error ? error.message : "Konto konnte nicht geändert werden."); }
  }
  async function resetPassword() {
    if (!window.confirm(`Kennwort für ${student.displayName} zurücksetzen? Alle Sitzungen dieses Kontos werden beendet.`)) return;
    try {
      const result = await apiRequest<ResetStudentPasswordResponse>(`/api/teacher/students/${student.id}/reset-password`, { method: "POST" });
      onCredentials({ student: { ...student, mustChangePassword: true }, initialPassword: result.initialPassword });
      onMessage("Ein neues Erstkennwort wurde erstellt. Es wird nur jetzt angezeigt.");
      onReload();
    } catch (error) { onMessage(error instanceof Error ? error.message : "Kennwort konnte nicht zurückgesetzt werden."); }
  }
  if (!editing) return <tr><td><strong>{student.displayName}</strong></td><td><code>{student.loginId}</code></td><td>{student.teamName ?? "–"}</td><td><span className={`badge ${student.active ? "success" : "muted-badge"}`}>{student.active ? "Aktiv" : "Inaktiv"}</span></td><td><div className="table-actions"><button className="text-button" onClick={() => setEditing(true)}>Bearbeiten</button><button className="text-button" onClick={() => void resetPassword()}>Kennwort neu</button></div></td></tr>;
  return <tr className="editing-row"><td><input aria-label="Name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></td><td><input aria-label="Schul-ID" value={loginId} onChange={(event) => setLoginId(event.target.value.toLowerCase())} /></td><td><select aria-label="Team" required value={teamId} onChange={(event) => setTeamId(event.target.value)}>{allowNoTeam && <option value="">Kein Team</option>}{!allowNoTeam && !teamId && <option disabled value="">Team auswählen</option>}{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></td><td><select aria-label="Kontostatus" value={active ? "active" : "inactive"} onChange={(event) => setActive(event.target.value === "active")}><option value="active">Aktiv</option><option value="inactive">Inaktiv</option></select></td><td><div className="table-actions"><button className="text-button" disabled={!allowNoTeam && !teamId} onClick={() => void save()}>Speichern</button><button className="text-button danger" onClick={() => setEditing(false)}>Abbrechen</button></div></td></tr>;
}

function teacherPermissionLabels(teacher: StudentManagementResponse["teachers"][number]) {
  if (teacher.canManageAccounts) return ["Administration"];
  const labels: string[] = [];
  if (teacher.canManageTeams) labels.push("Teams & Konten");
  if (teacher.canManageAssessments) labels.push("GNs verwalten");
  if (teacher.canManagePlanning) labels.push("Räume & Termine");
  if (labels.length === 0) labels.push("Lerncoach");
  return labels;
}

function EditableTeacherRow({ teacher, teams, onReload, onMessage, onCredentials }: {
  teacher: StudentManagementResponse["teachers"][number];
  teams: StudentManagementResponse["teams"];
  onReload: () => void;
  onMessage: (message: string) => void;
  onCredentials: (credentials: CreateTeacherResponse) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(teacher.displayName);
  const [loginId, setLoginId] = useState(teacher.loginId);
  const [active, setActive] = useState(teacher.active);
  const [teamIds, setTeamIds] = useState(teacher.teamIds);
  const [canManageAccounts, setCanManageAccounts] = useState(teacher.canManageAccounts);
  const [canManageTeams, setCanManageTeams] = useState(teacher.canManageTeams);
  const [canManageAssessments, setCanManageAssessments] = useState(teacher.canManageAssessments);
  const [canManagePlanning, setCanManagePlanning] = useState(teacher.canManagePlanning);
  function toggleTeam(teamId: string) { setTeamIds((ids) => ids.includes(teamId) ? ids.filter((id) => id !== teamId) : [...ids, teamId]); }
  async function save() {
    try {
      await apiRequest(`/api/teacher/teachers/${teacher.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          displayName,
          loginId,
          active,
          teamIds,
          canManageAccounts,
          canManageTeams: canManageAccounts || canManageTeams,
          canManageAssessments: canManageAccounts || canManageAssessments,
          canManagePlanning: canManageAccounts || canManagePlanning
        })
      });
      setEditing(false); onMessage("Lehrkraftkonto wurde aktualisiert."); onReload();
    } catch (error) { onMessage(error instanceof Error ? error.message : "Lehrkraftkonto konnte nicht geändert werden."); }
  }
  async function resetPassword() {
    if (!window.confirm(`Kennwort für ${teacher.displayName} zurücksetzen?`)) return;
    try {
      const result = await apiRequest<ResetStudentPasswordResponse>(`/api/teacher/teachers/${teacher.id}/reset-password`, { method: "POST" });
      onCredentials({ teacher, initialPassword: result.initialPassword });
      onMessage("Ein neues Lehrkraft-Erstkennwort wurde erzeugt und wird nur jetzt angezeigt.");
      onReload();
    } catch (error) { onMessage(error instanceof Error ? error.message : "Kennwort konnte nicht zurückgesetzt werden."); }
  }
  if (!editing) return <tr><td><strong>{teacher.displayName}</strong></td><td><code>{teacher.loginId}</code></td><td>{teacher.canManageAccounts ? "Alle Teams" : teams.filter((team) => teacher.teamIds.includes(team.id)).map((team) => team.name).join(", ") || "Keine"}</td><td><div className="permission-badges">{teacherPermissionLabels(teacher).map((label) => <span className="badge muted-badge" key={label}>{label}</span>)}</div></td><td><span className={`badge ${teacher.active ? "success" : "muted-badge"}`}>{teacher.active ? "Aktiv" : "Inaktiv"}</span></td><td><div className="table-actions"><button className="text-button" onClick={() => setEditing(true)}>Bearbeiten</button>{!teacher.canManageAccounts && <button className="text-button" onClick={() => void resetPassword()}>Kennwort neu</button>}</div></td></tr>;
  return <tr className="editing-row"><td><input aria-label="Name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></td><td><input aria-label="Schul-ID" value={loginId} onChange={(event) => setLoginId(event.target.value.toLowerCase())} /></td><td><div className="team-chips">{teams.map((team) => <label className={teamIds.includes(team.id) ? "checked" : ""} key={team.id}><input checked={teamIds.includes(team.id)} disabled={canManageAccounts} onChange={() => toggleTeam(team.id)} type="checkbox" />{team.name}</label>)}</div></td><td><div className="permission-checklist"><label><input checked={canManageAccounts} onChange={(event) => setCanManageAccounts(event.target.checked)} type="checkbox" />Administration</label><label><input checked={canManageAccounts || canManageTeams} disabled={canManageAccounts} onChange={(event) => setCanManageTeams(event.target.checked)} type="checkbox" />Teams & Konten</label><label><input checked={canManageAccounts || canManageAssessments} disabled={canManageAccounts} onChange={(event) => setCanManageAssessments(event.target.checked)} type="checkbox" />GNs verwalten</label><label><input checked={canManageAccounts || canManagePlanning} disabled={canManageAccounts} onChange={(event) => setCanManagePlanning(event.target.checked)} type="checkbox" />Räume & Termine</label></div></td><td><select aria-label="Kontostatus" value={active ? "active" : "inactive"} onChange={(event) => setActive(event.target.value === "active")}><option value="active">Aktiv</option><option value="inactive">Inaktiv</option></select></td><td><div className="table-actions"><button className="text-button" disabled={!canManageAccounts && !teamIds.length} onClick={() => void save()}>Speichern</button><button className="text-button danger" onClick={() => setEditing(false)}>Abbrechen</button></div></td></tr>;
}

function ManagementView({ me }: { me: MeResponse }) {
  const [state, setState] = useState<LoadState<StudentManagementResponse>>({ status: "loading" });
  const [teamName, setTeamName] = useState("");
  const [studentName, setStudentName] = useState("");
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState<"team" | "teacher" | "student" | "invite" | "batch" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<CreateStudentResponse | null>(null);
  const [inviteTeamId, setInviteTeamId] = useState("");
  const [inviteValidDays, setInviteValidDays] = useState(7);
  const [inviteMaxUses, setInviteMaxUses] = useState(30);
  const [createdInvitation, setCreatedInvitation] = useState<CreateInvitationResponse | null>(null);
  const [batchTeamId, setBatchTeamId] = useState("");
  const [batchNames, setBatchNames] = useState("");
  const [batchResult, setBatchResult] = useState<BatchCreateStudentsResponse | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [teacherName, setTeacherName] = useState("");
  const [teacherTeamIds, setTeacherTeamIds] = useState<string[]>([]);
  const [teacherCanManageAccounts, setTeacherCanManageAccounts] = useState(false);
  const [teacherCanManageTeams, setTeacherCanManageTeams] = useState(false);
  const [teacherCanManageAssessments, setTeacherCanManageAssessments] = useState(false);
  const [teacherCanManagePlanning, setTeacherCanManagePlanning] = useState(false);
  const [teacherCredentials, setTeacherCredentials] = useState<CreateTeacherResponse | null>(null);

  function loadManagement() {
    setState({ status: "loading" });
    void apiRequest<StudentManagementResponse>("/api/teacher/management")
      .then((data) => {
        setState({ status: "ready", data });
        if (!me.profile.canManageAccounts) {
          setTeamId((current) => current || data.teams[0]?.id || "");
        }
      })
      .catch((error: unknown) =>
        setState({ status: "error", message: error instanceof Error ? error.message : "Fehler" })
      );
  }

  useEffect(loadManagement, []);

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("team");
    setMessage(null);
    try {
      const created = await apiRequest<CreateTeamResponse>("/api/teacher/teams", {
        method: "POST",
        body: JSON.stringify({ name: teamName })
      });
      setTeamName("");
      setTeamId(created.team.id);
      setBatchTeamId(created.team.id);
      setInviteTeamId(created.team.id);
      setMessage(`Team ${created.team.name} wurde angelegt.`);
      loadManagement();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Team konnte nicht angelegt werden.");
    } finally {
      setBusy(null);
    }
  }

  async function createTeacher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("teacher");
    setMessage(null);
    setTeacherCredentials(null);
    try {
      const created = await apiRequest<CreateTeacherResponse>("/api/teacher/teachers", {
        method: "POST",
        body: JSON.stringify({
          displayName: teacherName,
          teamIds: teacherTeamIds,
          canManageAccounts: teacherCanManageAccounts,
          canManageTeams: teacherCanManageAccounts || teacherCanManageTeams,
          canManageAssessments: teacherCanManageAccounts || teacherCanManageAssessments,
          canManagePlanning: teacherCanManageAccounts || teacherCanManagePlanning
        })
      });
      setTeacherName("");
      setTeacherTeamIds([]);
      setTeacherCanManageAccounts(false);
      setTeacherCanManageTeams(false);
      setTeacherCanManageAssessments(false);
      setTeacherCanManagePlanning(false);
      setTeacherCredentials(created);
      setMessage("Persönliches Lehrkraftkonto wurde angelegt.");
      loadManagement();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Lehrkraftkonto konnte nicht angelegt werden.");
    } finally { setBusy(null); }
  }

  async function createStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("student");
    setMessage(null);
    setCredentials(null);
    try {
      const created = await apiRequest<CreateStudentResponse>("/api/teacher/students", {
        method: "POST",
        body: JSON.stringify({ displayName: studentName, teamId: teamId || null })
      });
      setStudentName("");
      setCredentials(created);
      loadManagement();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Konto konnte nicht angelegt werden.");
    } finally {
      setBusy(null);
    }
  }

  async function createStudentBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const names = batchNames
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean)
      .filter((name, index) => !(index === 0 && /^(name|schüler|schülerin|schüler\/in)$/i.test(name)));
    if (names.length === 0) {
      setMessage("Bitte mindestens einen Namen einfügen.");
      return;
    }

    setBusy("batch");
    setMessage(null);
    setBatchResult(null);
    try {
      const result = await apiRequest<BatchCreateStudentsResponse>("/api/teacher/students/batch", {
        method: "POST",
        body: JSON.stringify({ teamId: batchTeamId, names })
      });
      setBatchResult(result);
      if (result.accounts.length > 0) downloadCredentialList(result);
      setBatchNames(result.failures.map((failure) => failure.displayName).join("\n"));
      setMessage(
        result.failures.length === 0
          ? `${result.accounts.length} Konten wurden erstellt. Die Zugangsliste wurde heruntergeladen.`
          : `${result.accounts.length} Konten erstellt; ${result.failures.length} Namen konnten nicht verarbeitet werden.`
      );
      loadManagement();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Die Klassenliste konnte nicht erstellt werden.");
    } finally {
      setBusy(null);
    }
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("invite");
    setMessage(null);
    setCreatedInvitation(null);
    try {
      const created = await apiRequest<CreateInvitationResponse>("/api/teacher/invitations", {
        method: "POST",
        body: JSON.stringify({ teamId: inviteTeamId, validDays: inviteValidDays, maxUses: inviteMaxUses })
      });
      setCreatedInvitation(created);
      loadManagement();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Einladung konnte nicht erstellt werden.");
    } finally {
      setBusy(null);
    }
  }

  async function revokeInvitation(id: string) {
    setMessage(null);
    try {
      await apiRequest<{ revoked: true }>(`/api/teacher/invitations/${id}/revoke`, { method: "POST" });
      setMessage("Einladung wurde deaktiviert.");
      if (createdInvitation?.invitation.id === id) setCreatedInvitation(null);
      loadManagement();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Einladung konnte nicht deaktiviert werden.");
    }
  }

  async function copyCredentials() {
    if (!credentials) return;
    await copyText(
      `Name: ${credentials.student.displayName}\nID: ${credentials.student.loginId}\nStartpasswort: ${credentials.initialPassword}`
    );
    setMessage("Zugangsdaten wurden kopiert.");
  }

  const data = state.status === "ready" ? state.data : null;
  const visibleStudents = data?.students.filter((student) => !selectedTeamId || student.teamId === selectedTeamId) ?? [];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Verwaltung</p>
          <h1>Teams und Schülerkonten</h1>
          <p>IDs werden aus dem Namen erzeugt. Startpasswörter erscheinen nur einmal.</p>
        </div>
      </div>

      <div className="form-grid">
        <section className="content-card form-card">
          <div className="section-heading"><span className="step-number">1</span><div><h2>Team anlegen</h2><p>Zum Beispiel 5A oder Team Blau.</p></div></div>
          <form onSubmit={createTeam}>
            <label>Teamname<input value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="z. B. 5A" required /></label>
            <button className="secondary-button" disabled={busy !== null} type="submit">{busy === "team" ? "Wird angelegt …" : "Team hinzufügen"}</button>
          </form>
        </section>

        <section className="content-card form-card">
          <div className="section-heading"><span className="step-number">2</span><div><h2>Schüler*in einladen</h2><p>Konto mit sicherem Startpasswort erstellen.</p></div></div>
          <form onSubmit={createStudent}>
            <label>Vor- und Nachname<input value={studentName} onChange={(event) => setStudentName(event.target.value)} placeholder="z. B. Mia Mustermann" required /></label>
            <label>Team<select required={!me.profile.canManageAccounts} value={teamId} onChange={(event) => setTeamId(event.target.value)}>{me.profile.canManageAccounts && <option value="">Noch keinem Team zuordnen</option>}{!me.profile.canManageAccounts && !teamId && <option disabled value="">Team auswählen</option>}{data?.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
            <button className="primary-button" disabled={busy !== null || (!me.profile.canManageAccounts && !teamId)} type="submit">{busy === "student" ? "Konto wird erstellt …" : "Konto erstellen"}</button>
          </form>
        </section>
      </div>

      {data && data.teams.length > 0 && (
        <section className="content-card">
          <div className="section-title-row flush"><div><p className="eyebrow">Teams bearbeiten</p><h2>Team öffnen und Mitglieder verwalten</h2></div><button className="text-button" onClick={() => setSelectedTeamId(null)}>Alle anzeigen</button></div>
          <div className="team-card-grid">
            {data.teams.map((team) => <EditableTeamCard key={team.id} onMessage={setMessage} onReload={loadManagement} onSelect={() => setSelectedTeamId(team.id)} selected={selectedTeamId === team.id} team={team} />)}
          </div>
        </section>
      )}

      {data && me.profile.canManageAccounts && (
        <section className="content-card teacher-management-card">
          <div className="section-title-row flush"><div><p className="eyebrow">Persönliche Lehrkraftkonten</p><h2>Lerncoaches und Berechtigungen</h2><p className="muted">Jede Lehrkraft erhält einen eigenen Zugang. Teamzugriff und zusätzliche Verwaltungsrechte werden getrennt vergeben. Es können höchstens zwei Administrationskonten aktiv sein.</p></div></div>
          <form className="teacher-create-form" onSubmit={createTeacher}>
            <label>Name<input required value={teacherName} onChange={(event) => setTeacherName(event.target.value)} placeholder="Vor- und Nachname" /></label>
            <fieldset><legend>Zugriff auf Teams</legend><div className="team-chips">{data.teams.map((team) => <label className={teacherTeamIds.includes(team.id) ? "checked" : ""} key={team.id}><input checked={teacherTeamIds.includes(team.id)} disabled={teacherCanManageAccounts} onChange={() => setTeacherTeamIds((ids) => ids.includes(team.id) ? ids.filter((id) => id !== team.id) : [...ids, team.id])} type="checkbox" />{team.name}</label>)}</div></fieldset>
            <fieldset><legend>Zusätzliche Rechte</legend><div className="permission-checklist"><label><input checked={teacherCanManageAccounts} onChange={(event) => setTeacherCanManageAccounts(event.target.checked)} type="checkbox" />Administration (alle Bereiche)</label><label><input checked={teacherCanManageAccounts || teacherCanManageTeams} disabled={teacherCanManageAccounts} onChange={(event) => setTeacherCanManageTeams(event.target.checked)} type="checkbox" />Teams und Schülerkonten</label><label><input checked={teacherCanManageAccounts || teacherCanManageAssessments} disabled={teacherCanManageAccounts} onChange={(event) => setTeacherCanManageAssessments(event.target.checked)} type="checkbox" />Gelingensnachweise verwalten</label><label><input checked={teacherCanManageAccounts || teacherCanManagePlanning} disabled={teacherCanManageAccounts} onChange={(event) => setTeacherCanManagePlanning(event.target.checked)} type="checkbox" />Räume und Zeitfenster planen</label></div></fieldset>
            <button className="primary-button" disabled={busy !== null || (!teacherCanManageAccounts && !teacherTeamIds.length)} type="submit">{busy === "teacher" ? "Wird angelegt …" : "Lehrkraft anlegen"}</button>
          </form>
          {teacherCredentials && <div className="credential-inline" role="status"><span><strong>{teacherCredentials.teacher.displayName}</strong><small>ID: {teacherCredentials.teacher.loginId} · Erstkennwort: {teacherCredentials.initialPassword}</small></span><button className="secondary-button" onClick={() => printCredential(teacherCredentials.teacher.displayName, teacherCredentials.teacher.loginId, teacherCredentials.initialPassword)}>Einzeln drucken</button></div>}
          <div className="table-scroll teacher-table"><table><thead><tr><th>Name</th><th>Schul-ID</th><th>Teams</th><th>Rechte</th><th>Status</th><th>Aktion</th></tr></thead><tbody>{data.teachers.map((teacher) => <EditableTeacherRow key={teacher.id} onCredentials={setTeacherCredentials} onMessage={setMessage} onReload={loadManagement} teacher={teacher} teams={data.teams} />)}</tbody></table></div>
        </section>
      )}

      <section className="content-card bulk-account-card">
        <div className="bulk-card-heading">
          <div>
            <span className="recommended-pill">Einfachster Weg</span>
            <p className="eyebrow">Ganze Klasse</p>
            <h2>Zugangsliste automatisch erstellen</h2>
            <p>Namen aus einer Klassenliste untereinander einfügen. Die App erstellt alle Konten und lädt sofort eine fertige Datei herunter.</p>
          </div>
          <div className="file-preview" aria-hidden="true">
            <span>CSV</span>
            <strong>Name · ID · Kennwort</strong>
          </div>
        </div>
        <div className="bulk-layout">
          <form className="bulk-form" onSubmit={createStudentBatch}>
            <label>
              1. Team auswählen
              <select value={batchTeamId} onChange={(event) => setBatchTeamId(event.target.value)} required>
                <option value="">Team auswählen</option>
                {data?.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
            <label>
              2. Namen einfügen – eine Person pro Zeile
              <textarea
                value={batchNames}
                onChange={(event) => setBatchNames(event.target.value)}
                placeholder={"Mia Mustermann\nLeon Beispiel\nAylin Muster"}
                rows={8}
                required
              />
            </label>
            <button className="primary-button bulk-submit" disabled={busy !== null || !data?.teams.length} type="submit">
              {busy === "batch" ? "Konten und Datei werden erstellt …" : "3. Konten erstellen & Datei herunterladen"}
            </button>
          </form>
          <aside className="bulk-explanation">
            <h3>Das passiert automatisch</h3>
            <ol>
              <li><span>1</span><p><strong>Kurze Schul-ID</strong>Aus „Mia Mustermann“ wird z. B. „mmustermann“.</p></li>
              <li><span>2</span><p><strong>Einfaches Erstkennwort</strong>Jede Person erhält eine zufällige zehnstellige Zahl.</p></li>
              <li><span>3</span><p><strong>Fertige Datei</strong>Die Liste öffnet sich in Excel, LibreOffice oder Numbers.</p></li>
            </ol>
            <p className="privacy-callout">Erstkennwörter werden nur in der heruntergeladenen Datei angezeigt und nicht lesbar gespeichert.</p>
          </aside>
        </div>
      </section>

      {batchResult && batchResult.accounts.length > 0 && (
        <section className="batch-result-card" aria-live="polite">
          <div className="batch-result-icon">✓</div>
          <div>
            <p className="eyebrow">Zugangsliste fertig</p>
            <h2>{batchResult.teamName}: {batchResult.accounts.length} neue Konten</h2>
            <p>Bewahre die Datei geschützt auf und gib jeder Person nur die eigene Zeile.</p>
            {batchResult.failures.length > 0 && <p className="batch-warning">Nicht erstellt: {batchResult.failures.map((failure) => failure.displayName).join(", ")}</p>}
          </div>
          <button className="secondary-button" onClick={() => downloadCredentialList(batchResult)}>Datei erneut herunterladen</button>
        </section>
      )}

      <section className="content-card invite-builder">
        <div className="invite-builder-copy">
          <p className="eyebrow">Einladungslink</p>
          <h2>Ein Team per QR-Code einladen</h2>
          <p>Der Link erstellt ausschließlich Schülerkonten für das ausgewählte Team. Gültigkeit und maximale Einlösungen begrenzen die Einladung.</p>
        </div>
        <form className="invite-form" onSubmit={createInvitation}>
          <label>
            Team
            <select value={inviteTeamId} onChange={(event) => setInviteTeamId(event.target.value)} required>
              <option value="">Team auswählen</option>
              {data?.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          <label>
            Gültig (Tage)
            <input max={30} min={1} type="number" value={inviteValidDays} onChange={(event) => setInviteValidDays(Number(event.target.value))} required />
          </label>
          <label>
            Max. Konten
            <input max={100} min={1} type="number" value={inviteMaxUses} onChange={(event) => setInviteMaxUses(Number(event.target.value))} required />
          </label>
          <button className="primary-button" disabled={busy !== null || !data?.teams.length} type="submit">
            {busy === "invite" ? "Einladung wird erstellt …" : "QR-Einladung erstellen"}
          </button>
        </form>
      </section>

      {createdInvitation && <InvitationLinkCard created={createdInvitation} />}

      {message && <p className="status-box" role="status">{message}</p>}
      {credentials && (
        <section className="credential-card" aria-live="polite">
          <div><p className="eyebrow">Einmalige Zugangsdaten</p><h2>{credentials.student.displayName}</h2><p>Jetzt sicher kopieren oder einzeln an die Person ausgeben.</p></div>
          <dl><div><dt>Schul-ID</dt><dd>{credentials.student.loginId}</dd></div><div><dt>Startpasswort</dt><dd>{credentials.initialPassword}</dd></div></dl>
          <div className="button-row"><button className="secondary-button light" onClick={() => void copyCredentials()}>Kopieren</button><button className="secondary-button light" onClick={() => printCredential(credentials.student.displayName, credentials.student.loginId, credentials.initialPassword)}>Einzeln drucken</button></div>
        </section>
      )}

      <section className="content-card table-card">
        <div className="section-title-row"><div><p className="eyebrow">Konten</p><h2>{selectedTeamId ? `${data?.teams.find((team) => team.id === selectedTeamId)?.name ?? "Team"} verwalten` : "Schüler*innen"}</h2></div><span className="count-badge">{visibleStudents.length}</span></div>
        {state.status === "loading" && <p className="muted">Konten werden geladen …</p>}
        {state.status === "error" && <p className="form-error">{state.message}</p>}
        {data && visibleStudents.length === 0 && <div className="inline-empty"><strong>Noch keine Schülerkonten</strong><span>Nutze das Formular oben, um die erste Person hinzuzufügen.</span></div>}
        {data && visibleStudents.length > 0 && (
          <div className="table-scroll"><table><thead><tr><th>Name</th><th>Schul-ID</th><th>Team</th><th>Status</th><th>Aktion</th></tr></thead><tbody>{visibleStudents.map((student) => (
            <EditableStudentRow allowNoTeam={me.profile.canManageAccounts} key={student.id} onCredentials={setCredentials} onMessage={setMessage} onReload={loadManagement} student={student} teams={data.teams} />
          ))}</tbody></table></div>
        )}
      </section>

      <section className="content-card table-card">
        <div className="section-title-row"><div><p className="eyebrow">Sicherheit</p><h2>Letzte Einladungen</h2></div><span className="count-badge">{data?.invitations.length ?? 0}</span></div>
        {data && data.invitations.length === 0 && <div className="inline-empty"><strong>Noch keine Einladungen</strong><span>Erstelle oben den ersten Link oder QR-Code.</span></div>}
        {data && data.invitations.length > 0 && (
          <div className="table-scroll"><table><thead><tr><th>Team</th><th>Nutzung</th><th>Gültig bis</th><th>Status</th><th></th></tr></thead><tbody>{data.invitations.map((invitation) => (
            <tr key={invitation.id}>
              <td><strong>{invitation.teamName}</strong></td>
              <td>{invitation.useCount} / {invitation.maxUses}</td>
              <td>{new Date(invitation.expiresAt).toLocaleString("de-DE")}</td>
              <td><span className={`badge ${invitation.active ? "success" : "muted-badge"}`}>{invitation.active ? "Aktiv" : "Beendet"}</span></td>
              <td>{invitation.active && <button className="text-button danger" onClick={() => void revokeInvitation(invitation.id)}>Deaktivieren</button>}</td>
            </tr>
          ))}</tbody></table></div>
        )}
      </section>
    </>
  );
}

type DemoDataAction = "create" | "reset" | "delete";

function DemoDataAdmin() {
  const [state, setState] = useState<LoadState<DemoDataStatusResponse>>({ status: "loading" });
  const [pending, setPending] = useState<DemoDataAction | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [credentials, setCredentials] = useState<DemoCredential[] | null>(null);

  function loadStatus() {
    setState({ status: "loading" });
    void apiRequest<DemoDataStatusResponse>("/api/teacher/demo-data")
      .then((status) => setState({ status: "ready", data: status }))
      .catch((error: unknown) => setState({
        status: "error",
        message: error instanceof Error ? error.message : "Der Demodaten-Status konnte nicht geladen werden."
      }));
  }

  useEffect(loadStatus, []);

  async function createDemoData() {
    if (!window.confirm("Demodaten mit Beispiel-Teams, Räumen, Schüler*innen und Terminen anlegen? Vorhandene echte Daten bleiben unberührt.")) return;
    setPending("create");
    setMessage(null);
    setCredentials(null);
    try {
      const result = await apiRequest<CreateDemoDataResponse>("/api/teacher/demo-data", { method: "POST" });
      setState({ status: "ready", data: result.status });
      setCredentials(result.credentials);
      setMessage({ kind: "success", text: "Die Demodaten wurden angelegt. Bitte die Zugangsdaten jetzt sichern – sie werden nur dieses eine Mal angezeigt." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Die Demodaten konnten nicht angelegt werden." });
    } finally {
      setPending(null);
    }
  }

  async function resetDemoData() {
    if (!window.confirm("Demodaten wirklich auf den Ausgangszustand zurücksetzen? Alle Buchungen und Änderungen innerhalb der Demo werden gelöscht. Echte Schuldaten bleiben unberührt.")) return;
    setPending("reset");
    setMessage(null);
    setCredentials(null);
    try {
      const result = await apiRequest<CreateDemoDataResponse>("/api/teacher/demo-data/reset", { method: "POST" });
      setState({ status: "ready", data: result.status });
      setCredentials(result.credentials);
      setMessage({ kind: "success", text: "Die Demo ist wieder im Ausgangszustand. Die neuen Zugangsdaten werden nur jetzt angezeigt." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Die Demodaten konnten nicht zurückgesetzt werden." });
    } finally {
      setPending(null);
    }
  }

  async function deleteDemoData() {
    if (!window.confirm("Alle gekennzeichneten Demodaten endgültig löschen? Echte Schuldaten und das Masterkonto bleiben erhalten.")) return;
    setPending("delete");
    setMessage(null);
    setCredentials(null);
    try {
      const result = await apiRequest<DeleteDemoDataResponse>("/api/teacher/demo-data/delete", { method: "POST" });
      setState({ status: "ready", data: result.status });
      setMessage({ kind: "success", text: result.deleted ? "Die Demodaten wurden vollständig gelöscht." : "Es waren keine Demodaten zum Löschen vorhanden." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Die Demodaten konnten nicht gelöscht werden." });
    } finally {
      setPending(null);
    }
  }

  async function copyCredentials() {
    if (!credentials) return;
    try {
      await copyText(demoCredentialText(credentials));
      setMessage({ kind: "success", text: "Alle Demo-Zugangsdaten wurden in die Zwischenablage kopiert." });
    } catch {
      setMessage({ kind: "error", text: "Die Zugangsdaten konnten nicht kopiert werden. Lade sie stattdessen als CSV-Datei herunter." });
    }
  }

  const status = state.status === "ready" ? state.data : null;
  const countItems = status ? [
    ["Teams", status.counts.teams],
    ["Schüler*innen", status.counts.students],
    ["Räume", status.counts.rooms],
    ["Gelingensnachweise", status.counts.assessments],
    ["Terminserien", status.counts.schedules],
    ["Einzeltermine", status.counts.appointments],
    ["Buchungen", status.counts.bookings]
  ] as const : [];

  return (
    <section className="content-card demo-data-card" aria-busy={pending !== null}>
      <div className="demo-data-heading">
        <div>
          <p className="eyebrow">Vorführung</p>
          <h2>Demodaten verwalten</h2>
          <p className="muted">Lege eine fertige Beispielumgebung an, setze sie nach einem Test zurück oder entferne sie vollständig. Echte Schuldaten und dein Masterkonto werden dabei nicht verändert.</p>
        </div>
        {status && <span className={`demo-status-badge ${status.active ? "active" : "inactive"}`}>{status.active ? "Demo aktiv" : "Keine Demodaten"}</span>}
      </div>

      {state.status === "loading" && <p className="muted" role="status">Demodaten-Status wird geladen …</p>}
      {state.status === "error" && (
        <div className="demo-load-error">
          <p className="form-error" role="alert">{state.message}</p>
          <button className="secondary-button" onClick={loadStatus} type="button">Erneut versuchen</button>
        </div>
      )}

      {status && (
        <>
          {status.active && (
            <div className="demo-count-grid" aria-label="Umfang der Demodaten">
              {countItems.map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}
            </div>
          )}
          <div className="demo-actions">
            {!status.active ? (
              <button className="primary-button" disabled={pending !== null} onClick={() => void createDemoData()} type="button">
                {pending === "create" ? "Demodaten werden angelegt …" : "Demodaten anlegen"}
              </button>
            ) : (
              <>
                <button className="secondary-button" disabled={pending !== null} onClick={() => void resetDemoData()} type="button">
                  {pending === "reset" ? "Demo wird zurückgesetzt …" : "Auf Ausgangszustand zurücksetzen"}
                </button>
                <button className="secondary-button danger-button" disabled={pending !== null} onClick={() => void deleteDemoData()} type="button">
                  {pending === "delete" ? "Demodaten werden gelöscht …" : "Demodaten löschen"}
                </button>
              </>
            )}
            {status.active && status.createdAt && <small>Angelegt am {new Date(status.createdAt).toLocaleString("de-DE")}</small>}
          </div>
        </>
      )}

      {message && <p className={message.kind === "error" ? "form-error" : "form-success"} role="status">{message.text}</p>}

      {credentials && credentials.length > 0 && (
        <div className="demo-credentials">
          <div className="demo-credentials-heading">
            <div><p className="eyebrow">Nur jetzt sichtbar</p><h3>Demo-Zugangsdaten</h3><p>Speichere die Liste als CSV-Datei oder kopiere sie. Später können diese Erstkennwörter nicht erneut angezeigt werden.</p></div>
            <div className="button-row">
              <button className="secondary-button" onClick={() => void copyCredentials()} type="button">Alle kopieren</button>
              <button className="secondary-button" onClick={() => downloadDemoCredentialList(credentials)} type="button">CSV herunterladen</button>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Name</th><th>Team</th><th>Schul-ID</th><th>Erstkennwort</th></tr></thead>
              <tbody>{credentials.map((credential) => (
                <tr key={credential.loginId}><td><strong>{credential.displayName}</strong></td><td>{credential.teamName}</td><td><code>{credential.loginId}</code></td><td><code>{credential.initialPassword}</code></td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function SettingsView({ me, onPasswordChanged }: { me: MeResponse; onPasswordChanged?: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatusResponse | null>(null);
  const permissionSummary = me.profile.role === "TEACHER"
    ? me.profile.canManageAccounts
      ? "Alle Bereiche"
      : [
          me.profile.canManageTeams ? "Teams & Konten" : null,
          me.profile.canManageAssessments ? "GNs verwalten" : null,
          me.profile.canManagePlanning ? "Räume & Termine" : null
        ].filter(Boolean).join(", ") || "Lerncoach"
    : null;

  useEffect(() => {
    if (me.profile.role === "TEACHER" && me.profile.canManageAccounts) {
      void apiRequest<SystemStatusResponse>("/api/teacher/system-status").then(setSystemStatus).catch(() => undefined);
    }
  }, [me.profile.canManageAccounts, me.profile.role]);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      await apiRequest<ChangePasswordResponse>("/api/account/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage({ kind: "success", text: "Passwort wurde geändert. Andere Sitzungen wurden abgemeldet." });
      onPasswordChanged?.();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Passwort konnte nicht geändert werden." });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="page-heading"><div><p className="eyebrow">Einstellungen</p><h1>Mein Konto</h1><p>Persönliche Angaben und Zugangssicherheit.</p></div></div>
      {me.profile.mustChangePassword && (
        <p className="password-notice" role="status">
          Du verwendest noch dein Startpasswort. Lege jetzt ein persönliches Passwort fest.
        </p>
      )}
      {systemStatus && (
        <section className="system-status-grid">
          <div className={`system-status-item ${systemStatus.productionMode ? "good" : "warning"}`}><span>Betriebsmodus</span><strong>{systemStatus.productionMode ? "Produktion" : "Entwicklung"}</strong></div>
          <div className={`system-status-item ${systemStatus.transportSecurity === "https" ? "good" : "warning"}`}><span>Verbindung</span><strong>{systemStatus.transportSecurity === "https" ? "HTTPS" : "HTTP – nur Pilotbetrieb"}</strong></div>
          <div className={`system-status-item ${systemStatus.backup.lastSuccessAt ? "good" : "warning"}`}><span>Letzte Sicherung</span><strong>{systemStatus.backup.lastSuccessAt ? new Date(systemStatus.backup.lastSuccessAt).toLocaleString("de-DE") : "Noch nicht bestätigt"}</strong><small>{systemStatus.backup.lastFilename ?? systemStatus.backup.lastError ?? systemStatus.backup.directory}</small></div>
          <div className={`system-status-item ${systemStatus.backup.mirrorConfigured ? "good" : "warning"}`}><span>Zweites Sicherungsziel</span><strong>{systemStatus.backup.mirrorConfigured ? "Eingerichtet" : "Noch nicht eingerichtet"}</strong></div>
        </section>
      )}
      <div className="settings-grid">
        <section className="content-card profile-card">
          <div className="large-avatar">{me.profile.displayName.slice(0, 1).toUpperCase()}</div>
          <div><p className="eyebrow">Profil</p><h2>{me.profile.displayName}</h2><dl className="profile-details"><div><dt>Schul-ID</dt><dd>{me.profile.loginId}</dd></div><div><dt>Rolle</dt><dd>{me.profile.role === "TEACHER" ? (me.profile.canManageAccounts ? "Administration" : "Lehrkraft") : "Schüler*in"}</dd></div>{permissionSummary && <div><dt>Berechtigungen</dt><dd>{permissionSummary}</dd></div>}</dl></div>
        </section>
        <section className="content-card form-card">
          <div><p className="eyebrow">Sicherheit</p><h2>Passwort ändern</h2><p className="muted">Mindestens 10 Zeichen. Alle anderen Sitzungen werden beendet.</p></div>
          <form onSubmit={changePassword}>
            <label>Aktuelles Passwort<input autoComplete="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
            <label>Neues Passwort<input autoComplete="new-password" minLength={10} type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
            <label>Neues Passwort wiederholen<input autoComplete="new-password" minLength={10} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
            {message && <p className={message.kind === "error" ? "form-error" : "form-success"} role="status">{message.text}</p>}
            <button className="primary-button" disabled={pending} type="submit">{pending ? "Wird geändert …" : "Passwort ändern"}</button>
          </form>
        </section>
      </div>
      {me.profile.role === "TEACHER" && me.profile.canManageAccounts && <DemoDataAdmin />}
    </>
  );
}

function StudentOverview({ me, onBook }: { me: MeResponse; onBook: () => void }) {
  const [state, setState] = useState<LoadState<StudentOverviewResponse>>({ status: "loading" });
  const [message, setMessage] = useState("");
  function load() {
    void apiRequest<StudentOverviewResponse>("/api/student/overview")
      .then((data) => setState({ status: "ready", data }))
      .catch((error: unknown) => setState({ status: "error", message: error instanceof Error ? error.message : "Fehler" }));
  }
  useEffect(load, []);
  async function cancel(id: string, version: number) {
    if (!window.confirm("Möchtest du dich wirklich von diesem Termin abmelden?")) return;
    try {
      await apiRequest(`/api/student/bookings/${id}/cancel`, { method: "POST", body: JSON.stringify({ version }) });
      setMessage("Du wurdest vom Termin abgemeldet.");
      load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Abmeldung war nicht möglich."); }
  }
  return (
    <>
      <div className="page-heading"><div><p className="eyebrow">Meine Übersicht</p><h1>Hallo, {me.profile.displayName}</h1><p>Deine geplanten und erledigten Gelingensnachweise.</p></div><button className="primary-button compact" onClick={onBook}>Neuen Termin buchen</button></div>
      {state.status === "loading" && <p className="status-box">Termine werden geladen …</p>}
      {state.status === "error" && <p className="status-box error">{state.message}</p>}
      {state.status === "ready" && state.data.bookings.length === 0 && <section className="content-card empty-state"><div className="empty-icon">✓</div><h2>Noch kein Termin geplant</h2><p>Sobald Termine freigeschaltet sind und du einen Termin buchst, erscheint er hier.</p><button className="primary-button compact" onClick={onBook}>Zur Terminbuchung</button></section>}
      {state.status === "ready" && state.data.bookings.length > 0 && <section className="booking-list">{state.data.bookings.map((booking) => <article className="booking-card" key={booking.id}><div><span className={`badge status-${booking.status.toLowerCase()}`}>{booking.status === "PLANNED" ? "Geplant" : booking.status === "COMPLETED" ? "Erledigt" : "Abgemeldet"}</span><h2>{booking.subject} · {booking.learningHouse}</h2><p>{booking.assessmentTitle}</p>{booking.comment && <p className="booking-comment">Kommentar: {booking.comment}</p>}</div><dl><div><dt>Termin</dt><dd>{new Date(booking.startsAt).toLocaleString("de-DE")}</dd></div><div><dt>Raum</dt><dd>{booking.roomName}</dd></div>{booking.status === "PLANNED" && <div><dt>Abmeldung</dt><dd>{booking.cancellationAllowed ? <button className="text-button danger" onClick={() => void cancel(booking.id, booking.version)}>Abmelden</button> : `Gesperrt seit ${new Date(booking.cancellationDeadline).toLocaleString("de-DE")}`}</dd></div>}</dl></article>)}</section>}
      {message && <p className="status-box" role="status">{message}</p>}
    </>
  );
}

function DashboardFrame({ me, activeView, onNavigate, children }: { me: MeResponse; activeView: string; onNavigate: (view: string) => void; children: ReactNode }) {
  const isTeacher = me.profile.role === "TEACHER";
  const passwordChangeRequired = !isTeacher && me.profile.mustChangePassword;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav aria-label="Hauptnavigation">
          {!passwordChangeRequired && <button className={activeView === "overview" ? "active" : ""} onClick={() => onNavigate("overview")}>{isTeacher ? "Übersicht" : "Meine Übersicht"}</button>}
          {isTeacher && (me.profile.canManageAccounts || me.profile.canManageTeams) && <button className={activeView === "management" ? "active" : ""} onClick={() => onNavigate("management")}>Teams & Konten</button>}
          {isTeacher && (me.profile.canManageAccounts || me.profile.canManageAssessments || me.profile.canManagePlanning) && <button className={activeView === "planning" ? "active" : ""} onClick={() => onNavigate("planning")}>GN- & Terminplanung</button>}
          {isTeacher && <button className={activeView === "coach" ? "active" : ""} onClick={() => onNavigate("coach")}>Lerncoach-Übersicht</button>}
          {!isTeacher && !passwordChangeRequired && <button className={activeView === "booking" ? "active" : ""} onClick={() => onNavigate("booking")}>Termin buchen</button>}
          <button className={activeView === "settings" ? "active" : ""} onClick={() => onNavigate("settings")}>Einstellungen</button>
        </nav>
        <div className="account-box">
          <div className="avatar">{me.profile.displayName.slice(0, 1).toUpperCase()}</div>
          <div><strong>{me.profile.displayName}</strong><span>{isTeacher ? (me.profile.canManageAccounts ? "Administration" : "Lehrkraft") : "Schüler*in"}</span></div>
          <button aria-label="Abmelden" title="Abmelden" onClick={() => void authClient.signOut()}>↪</button>
        </div>
      </aside>
      <main className="dashboard">{children}</main>
    </div>
  );
}

function TeacherDashboard({ me }: { me: MeResponse }) {
  const [view, setView] = useState<TeacherView>("overview");
  return <DashboardFrame me={me} activeView={view} onNavigate={(next) => setView(next as TeacherView)}>{view === "overview" && <TeacherOverview me={me} onCoach={() => setView("coach")} onManage={() => setView("management")} />}{view === "management" && (me.profile.canManageAccounts || me.profile.canManageTeams) && <ManagementView me={me} />}{view === "planning" && (me.profile.canManageAccounts || me.profile.canManageAssessments || me.profile.canManagePlanning) && <PlanningView permissions={me.profile} />}{view === "coach" && <CoachView />}{view === "settings" && <SettingsView me={me} />}</DashboardFrame>;
}

function StudentDashboard({ me, onPasswordChanged }: { me: MeResponse; onPasswordChanged: () => void }) {
  const [view, setView] = useState<StudentView>(me.profile.mustChangePassword ? "settings" : "overview");
  return <DashboardFrame me={me} activeView={view} onNavigate={(next) => setView(next as StudentView)}>{view === "overview" && <StudentOverview me={me} onBook={() => setView("booking")} />}{view === "booking" && <StudentBookingView onOverview={() => setView("overview")} />}{view === "settings" && <SettingsView me={me} onPasswordChanged={onPasswordChanged} />}</DashboardFrame>;
}

export function App() {
  const invitationMatch = window.location.pathname.match(/^\/invite\/([A-Za-z0-9_-]{43})\/?$/);
  const invitationToken = invitationMatch?.[1] ?? null;
  const session = authClient.useSession();
  const [me, setMe] = useState<LoadState<MeResponse>>({ status: "loading" });

  useEffect(() => {
    if (!session.data) {
      setMe({ status: "loading" });
      return;
    }
    void apiRequest<MeResponse>("/api/me")
      .then((data) => setMe({ status: "ready", data }))
      .catch((error: unknown) => setMe({ status: "error", message: error instanceof Error ? error.message : "Fehler" }));
  }, [session.data]);

  if (invitationToken) return <InvitationRegistration token={invitationToken} />;
  if (session.isPending) return <main className="centered"><Brand /><p>Sitzung wird geprüft …</p></main>;
  if (!session.data) return <Login />;
  if (me.status === "loading") return <main className="centered"><Brand /><p>Profil wird geladen …</p></main>;
  if (me.status === "error") return <main className="centered"><Brand /><p className="form-error">{me.message}</p><button className="primary-button compact" onClick={() => void authClient.signOut()}>Abmelden</button></main>;
  return me.data.profile.role === "TEACHER"
    ? <TeacherDashboard me={me.data} />
    : <StudentDashboard
        me={me.data}
        onPasswordChanged={() => setMe({
          status: "ready",
          data: { profile: { ...me.data.profile, mustChangePassword: false } }
        })}
      />;
}
