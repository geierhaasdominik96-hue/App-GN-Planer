import type {
  AppointmentSummary,
  AssessmentSummary,
  PlanningAdminResponse,
  PlannerAppointment,
  SessionProfile,
  StudentPlannerResponse,
  TeamSummary,
  TeacherBookingSummary,
  TeacherCoachResponse
} from "@gn-planer/contracts";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { apiRequest, downloadAuthenticated, type LoadState } from "./api.js";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function isoWeek(value: string) {
  const date = new Date(value);
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return { year: utc.getUTCFullYear(), week: Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7) };
}

function weekKey(value: string) {
  const { year, week } = isoWeek(value);
  return `${year}-${String(week).padStart(2, "0")}`;
}

function weekLabel(value: string) {
  const { year, week } = isoWeek(value);
  return `KW ${week} · ${year}`;
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function StudentBookingView({ onOverview }: { onOverview: () => void }) {
  const [state, setState] = useState<LoadState<StudentPlannerResponse>>({ status: "loading" });
  const [selectedWeek, setSelectedWeek] = useState("");
  const [assessmentId, setAssessmentId] = useState("");
  const [comment, setComment] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function load() {
    setState({ status: "loading" });
    void apiRequest<StudentPlannerResponse>("/api/student/planner")
      .then((data) => {
        setState({ status: "ready", data });
        setSelectedWeek((current) => current || (data.appointments[0] ? weekKey(data.appointments[0].startsAt) : ""));
        setAssessmentId((current) => current || data.assessments[0]?.id || "");
      })
      .catch((error: unknown) => setState({ status: "error", message: errorText(error, "Termine konnten nicht geladen werden.") }));
  }

  useEffect(load, []);

  const data = state.status === "ready" ? state.data : null;
  const weeks = useMemo(() => {
    const map = new Map<string, PlannerAppointment[]>();
    for (const appointment of data?.appointments ?? []) {
      const key = weekKey(appointment.startsAt);
      map.set(key, [...(map.get(key) ?? []), appointment]);
    }
    return [...map.entries()];
  }, [data]);
  const visibleAppointments = weeks.find(([key]) => key === selectedWeek)?.[1] ?? [];

  async function book(appointmentId: string) {
    if (!assessmentId) {
      setMessage("Bitte zuerst einen Gelingensnachweis auswählen.");
      return;
    }
    setBusyId(appointmentId);
    setMessage(null);
    try {
      await apiRequest("/api/student/bookings", {
        method: "POST",
        body: JSON.stringify({ appointmentId, assessmentId, comment: comment.trim() || null })
      });
      setComment("");
      setMessage("Der Termin wurde verbindlich eingetragen.");
      load();
    } catch (error) {
      setMessage(errorText(error, "Der Termin konnte nicht gebucht werden."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div><p className="eyebrow">Terminbuchung</p><h1>Gelingensnachweis einplanen</h1><p>Wähle genau einen Nachweis und anschließend einen freien Termin.</p></div>
        <button className="secondary-button" onClick={onOverview}>Meine Buchungen</button>
      </div>
      {state.status === "loading" && <p className="status-box">Buchbare Termine werden geladen …</p>}
      {state.status === "error" && <p className="status-box error">{state.message}</p>}
      {data && (
        <>
          <section className="content-card booking-choice-card">
            <div><p className="eyebrow">Schritt 1</p><h2>Was möchtest du schreiben?</h2><p className="muted">Die Auswahl stammt aus den Nachweisen für {data.teamName ?? "dein Team"}.</p></div>
            {data.assessments.length === 0 ? <p className="form-error">Für dein Team wurden noch keine Gelingensnachweise hinterlegt.</p> : (
              <div className="assessment-choice-grid">
                {data.assessments.map((assessment) => (
                  <label className={`choice-tile ${assessmentId === assessment.id ? "selected" : ""}`} key={assessment.id}>
                    <input checked={assessmentId === assessment.id} name="assessment" onChange={() => setAssessmentId(assessment.id)} type="radio" />
                    <span><strong>{assessment.subject} · {assessment.learningHouse}</strong><small>{assessment.title}</small></span>
                  </label>
                ))}
              </div>
            )}
            <label>Kommentar an die Lehrkraft (optional)<textarea maxLength={1000} rows={3} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Zum Beispiel: Ich benötige einen Nachteilsausgleich." /></label>
          </section>

          <section className="content-card">
            <div className="section-title-row flush"><div><p className="eyebrow">Schritt 2</p><h2>Termin auswählen</h2></div></div>
            {weeks.length === 0 ? <div className="inline-empty no-border"><strong>Noch keine Termine veröffentlicht</strong><span>Bitte frage deine Lehrkraft, wann Termine angelegt werden.</span></div> : (
              <>
                <div className="week-tabs" role="tablist" aria-label="Kalenderwochen">
                  {weeks.map(([key, appointments]) => <button className={selectedWeek === key ? "active" : ""} key={key} onClick={() => setSelectedWeek(key)}>{weekLabel(appointments[0]!.startsAt)}<small>{appointments.length} Termine</small></button>)}
                </div>
                <div className="appointment-grid">
                  {visibleAppointments.map((appointment) => {
                    const blocked = !appointment.registrationOpen;
                    return (
                      <article className={`appointment-tile ${blocked ? "blocked" : ""}`} key={appointment.id}>
                        <div><span className="date-chip">{formatDate(appointment.startsAt)}</span><h3>{formatTime(appointment.startsAt)}–{formatTime(appointment.endsAt)}</h3><p>{appointment.roomName}</p></div>
                        <div className="capacity-line"><span>{appointment.remaining} von {appointment.capacity} Plätzen frei</span><progress max={appointment.capacity} value={appointment.booked} /></div>
                        {appointment.ownBookingId ? <button className="secondary-button" onClick={onOverview}>Bereits gebucht · zur Abmeldung</button> : <button className="primary-button" disabled={blocked || busyId !== null || !assessmentId} onClick={() => void book(appointment.id)}>{busyId === appointment.id ? "Wird gebucht …" : blocked ? (appointment.restrictionReason ?? "Nicht buchbar") : "Diesen Termin buchen"}</button>}
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </>
      )}
      {message && <p className="status-box" role="status">{message}</p>}
    </>
  );
}

function EditableRoom({ room, reload }: { room: PlanningAdminResponse["rooms"][number]; reload: () => void }) {
  const [name, setName] = useState(room.name);
  const [capacity, setCapacity] = useState(room.defaultCapacity);
  const [saved, setSaved] = useState(false);
  async function save() {
    await apiRequest(`/api/teacher/planning/rooms/${room.id}`, { method: "PATCH", body: JSON.stringify({ name, defaultCapacity: capacity }) });
    setSaved(true);
    reload();
  }
  return <div className="inline-editor"><input aria-label="Raumname" value={name} onChange={(event) => { setName(event.target.value); setSaved(false); }} /><input aria-label="Kapazität" min={1} type="number" value={capacity} onChange={(event) => { setCapacity(Number(event.target.value)); setSaved(false); }} /><button className="text-button" onClick={() => void save()}>{saved ? "Gespeichert" : "Speichern"}</button></div>;
}

function EditableAssessment({ assessment, teams, reload }: { assessment: AssessmentSummary; teams: PlanningAdminResponse["teams"]; reload: () => void }) {
  const [subject, setSubject] = useState(assessment.subject);
  const [learningHouse, setLearningHouse] = useState(assessment.learningHouse);
  const [title, setTitle] = useState(assessment.title);
  const [teamIds, setTeamIds] = useState(assessment.teamIds);
  const [message, setMessage] = useState("");
  function toggleTeam(teamId: string) { setTeamIds((ids) => ids.includes(teamId) ? ids.filter((id) => id !== teamId) : [...ids, teamId]); }
  async function save() {
    try {
      await apiRequest(`/api/teacher/planning/assessments/${assessment.id}`, { method: "PATCH", body: JSON.stringify({ subject, learningHouse, title, teamIds }) });
      setMessage("Gespeichert");
      reload();
    } catch (error) { setMessage(errorText(error, "Fehler")); }
  }
  return <article className="assessment-editor"><div className="editor-fields"><input aria-label="Fach" value={subject} onChange={(event) => setSubject(event.target.value)} /><input aria-label="Lernhaus" value={learningHouse} onChange={(event) => setLearningHouse(event.target.value)} /><input aria-label="Bezeichnung" value={title} onChange={(event) => setTitle(event.target.value)} /></div><div className="team-chips">{teams.map((team) => <label className={teamIds.includes(team.id) ? "checked" : ""} key={team.id}><input checked={teamIds.includes(team.id)} onChange={() => toggleTeam(team.id)} type="checkbox" />{team.name}</label>)}</div><button className="text-button" disabled={!teamIds.length} onClick={() => void save()}>{message || "Änderungen speichern"}</button></article>;
}

function EditableAppointment({ appointment, rooms, reload }: { appointment: AppointmentSummary; rooms: PlanningAdminResponse["rooms"]; reload: () => void }) {
  const [roomId, setRoomId] = useState(appointment.roomId);
  const [capacity, setCapacity] = useState(appointment.capacity);
  const start = new Date(appointment.startsAt);
  const end = new Date(appointment.endsAt);
  const [date, setDate] = useState(`${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`);
  const [startTime, setStartTime] = useState(`${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`);
  const [endTime, setEndTime] = useState(`${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`);
  const [message, setMessage] = useState("");
  async function save() {
    try {
      await apiRequest(`/api/teacher/planning/appointments/${appointment.id}`, { method: "PATCH", body: JSON.stringify({ roomId, capacity, startsAt: new Date(`${date}T${startTime}:00`).toISOString(), endsAt: new Date(`${date}T${endTime}:00`).toISOString(), version: appointment.version }) });
      setMessage("Gespeichert"); reload();
    } catch (error) { setMessage(errorText(error, "Fehler")); }
  }
  async function remove() {
    if (!window.confirm("Diesen einzelnen Termin wirklich aus der Serie entfernen?")) return;
    try { await apiRequest(`/api/teacher/planning/appointments/${appointment.id}/remove`, { method: "POST", body: JSON.stringify({ version: appointment.version }) }); reload(); }
    catch (error) { setMessage(errorText(error, "Termin konnte nicht entfernt werden.")); }
  }
  return <tr><td><input aria-label="Datum" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></td><td><div className="time-pair"><input aria-label="Beginn" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /><input aria-label="Ende" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></div></td><td><select value={roomId} onChange={(event) => setRoomId(event.target.value)}>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></td><td><input aria-label="Kapazität" min={appointment.booked || 1} type="number" value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} /></td><td>{appointment.booked}</td><td><div className="table-actions"><button className="text-button" onClick={() => void save()}>Speichern</button><button className="text-button danger" disabled={appointment.booked > 0} onClick={() => void remove()}>Entfernen</button></div>{message && <small>{message}</small>}</td></tr>;
}

export function PlanningView({ permissions }: { permissions: Pick<SessionProfile, "canManageAccounts" | "canManageAssessments" | "canManagePlanning"> }) {
  const [state, setState] = useState<LoadState<PlanningAdminResponse>>({ status: "loading" });
  const [roomName, setRoomName] = useState("");
  const [roomCapacity, setRoomCapacity] = useState(50);
  const [subject, setSubject] = useState("");
  const [learningHouse, setLearningHouse] = useState("");
  const [assessmentTitle, setAssessmentTitle] = useState("");
  const [assessmentTeams, setAssessmentTeams] = useState<string[]>([]);
  const [schedule, setSchedule] = useState({ name: "GN-Termin", startsOn: "", endsOn: "", startTime: "13:30", endTime: "14:30", roomId: "", capacity: 50 });
  const [message, setMessage] = useState("");

  function load() {
    void apiRequest<PlanningAdminResponse>("/api/teacher/planning")
      .then((data) => {
        setState({ status: "ready", data });
        setSchedule((current) => ({ ...current, roomId: current.roomId || data.rooms[0]?.id || "" }));
      })
      .catch((error: unknown) => setState({ status: "error", message: errorText(error, "Planung konnte nicht geladen werden.") }));
  }
  useEffect(load, []);
  const data = state.status === "ready" ? state.data : null;
  const canManageAssessments = permissions.canManageAccounts || permissions.canManageAssessments;
  const canManagePlanning = permissions.canManageAccounts || permissions.canManagePlanning;

  async function addRoom(event: FormEvent) {
    event.preventDefault(); setMessage("");
    try { await apiRequest("/api/teacher/planning/rooms", { method: "POST", body: JSON.stringify({ name: roomName, defaultCapacity: roomCapacity }) }); setRoomName(""); setMessage("Raum wurde angelegt."); load(); }
    catch (error) { setMessage(errorText(error, "Raum konnte nicht angelegt werden.")); }
  }
  async function addAssessment(event: FormEvent) {
    event.preventDefault(); setMessage("");
    try { await apiRequest("/api/teacher/planning/assessments", { method: "POST", body: JSON.stringify({ subject, learningHouse, title: assessmentTitle, teamIds: assessmentTeams }) }); setSubject(""); setLearningHouse(""); setAssessmentTitle(""); setMessage("Gelingensnachweis wurde angelegt."); load(); }
    catch (error) { setMessage(errorText(error, "Gelingensnachweis konnte nicht angelegt werden.")); }
  }
  async function addSchedule(event: FormEvent) {
    event.preventDefault(); setMessage("");
    try { const result = await apiRequest<{ occurrenceCount: number }>("/api/teacher/planning/schedules", { method: "POST", body: JSON.stringify(schedule) }); setMessage(`${result.occurrenceCount} wöchentliche Termine wurden erzeugt.`); load(); }
    catch (error) { setMessage(errorText(error, "Wochenserie konnte nicht angelegt werden.")); }
  }
  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try { await apiRequest("/api/teacher/planning/settings", { method: "PATCH", body: JSON.stringify({ bookingCutoffHours: Number(form.get("bookingDays")) * 24, cancellationCutoffHours: Number(form.get("cancellationDays")) * 24 }) }); setMessage("Fristen wurden gespeichert."); load(); }
    catch (error) { setMessage(errorText(error, "Fristen konnten nicht gespeichert werden.")); }
  }
  async function removeSchedule(id: string) {
    if (!window.confirm("Wochenserie beenden? Alle Termine der Serie werden für neue Buchungen gesperrt. Bereits bestehende Anmeldungen bleiben in den Übersichten erhalten.")) return;
    try { await apiRequest(`/api/teacher/planning/schedules/${id}/remove`, { method: "POST" }); setMessage("Wochenserie wurde beendet. Neue Buchungen sind gesperrt; bestehende Anmeldungen bleiben erhalten."); load(); }
    catch (error) { setMessage(errorText(error, "Serie konnte nicht beendet werden.")); }
  }

  return <>
    <div className="page-heading"><div><p className="eyebrow">GN- und Terminplanung</p><h1>{canManageAssessments && canManagePlanning ? "Räume, Nachweise und Wochenserien" : canManageAssessments ? "Gelingensnachweise verwalten" : "Räume und Wochenserien verwalten"}</h1><p>Hier erscheinen nur die Bereiche, die dir von der Administration freigegeben wurden.</p></div></div>
    {state.status === "loading" && <p className="status-box">Planung wird geladen …</p>}
    {state.status === "error" && <p className="status-box error">{state.message}</p>}
    {data && <>
      {canManagePlanning && <div className="planning-grid">
        <section className="content-card form-card"><p className="eyebrow">1 · Räume</p><h2>Räume und Kapazitäten</h2><form className="compact-form" onSubmit={addRoom}><label>Raum<input required value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder="z. B. Lernatelier 51" /></label><label>Standardplätze<input min={1} required type="number" value={roomCapacity} onChange={(event) => setRoomCapacity(Number(event.target.value))} /></label><button className="primary-button" type="submit">Raum anlegen</button></form><div className="editor-list">{data.rooms.map((room) => <EditableRoom key={room.id} room={room} reload={load} />)}</div></section>
        <section className="content-card form-card"><p className="eyebrow">4 · Fristen</p><h2>An- und Abmeldung</h2><form className="compact-form" onSubmit={saveSettings}><label>Anmeldung endet (Tage vorher)<input defaultValue={data.settings.bookingCutoffHours / 24} min={0} name="bookingDays" step="0.5" type="number" /></label><label>Abmeldung endet (Tage vorher)<input defaultValue={data.settings.cancellationCutoffHours / 24} min={0} name="cancellationDays" step="0.5" type="number" /></label><button className="secondary-button" type="submit">Fristen speichern</button></form></section>
      </div>}
      {canManageAssessments && <section className="content-card"><p className="eyebrow">Gelingensnachweise</p><h2>Fach, Lernhaus und Teams zuordnen</h2><form className="assessment-create-form" onSubmit={addAssessment}><label>Fach<input required value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Englisch" /></label><label>Lernhaus<input required value={learningHouse} onChange={(event) => setLearningHouse(event.target.value)} placeholder="Lernhaus 1" /></label><label>Bezeichnung<input required value={assessmentTitle} onChange={(event) => setAssessmentTitle(event.target.value)} placeholder="Unit 2" /></label><fieldset><legend>Für Teams</legend><div className="team-chips">{data.teams.map((team) => <label className={assessmentTeams.includes(team.id) ? "checked" : ""} key={team.id}><input checked={assessmentTeams.includes(team.id)} onChange={() => setAssessmentTeams((ids) => ids.includes(team.id) ? ids.filter((id) => id !== team.id) : [...ids, team.id])} type="checkbox" />{team.name}</label>)}</div></fieldset><button className="primary-button" disabled={!assessmentTeams.length} type="submit">Nachweis anlegen</button></form><div className="assessment-editor-list">{data.assessments.map((assessment) => <EditableAssessment assessment={assessment} key={assessment.id} reload={load} teams={data.teams} />)}</div></section>}
      {canManagePlanning && <section className="content-card"><p className="eyebrow">Wiederkehrende Termine</p><h2>Wochenserie anlegen</h2><form className="schedule-form" onSubmit={addSchedule}><label>Name<input required value={schedule.name} onChange={(event) => setSchedule({ ...schedule, name: event.target.value })} /></label><label>Erster Termin<input required type="date" value={schedule.startsOn} onChange={(event) => setSchedule({ ...schedule, startsOn: event.target.value })} /></label><label>Letzter Termin<input required type="date" value={schedule.endsOn} onChange={(event) => setSchedule({ ...schedule, endsOn: event.target.value })} /></label><label>Von<input required type="time" value={schedule.startTime} onChange={(event) => setSchedule({ ...schedule, startTime: event.target.value })} /></label><label>Bis<input required type="time" value={schedule.endTime} onChange={(event) => setSchedule({ ...schedule, endTime: event.target.value })} /></label><label>Raum<select required value={schedule.roomId} onChange={(event) => { const room = data.rooms.find((item) => item.id === event.target.value); setSchedule({ ...schedule, roomId: event.target.value, capacity: room?.defaultCapacity ?? schedule.capacity }); }}><option value="">Raum wählen</option>{data.rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label><label>Kapazität<input min={1} required type="number" value={schedule.capacity} onChange={(event) => setSchedule({ ...schedule, capacity: Number(event.target.value) })} /></label><button className="primary-button" disabled={!data.rooms.length} type="submit">Wochenserie erzeugen</button></form><div className="series-list">{data.schedules.map((item) => <div key={item.id}><span><strong>{item.name}</strong><small>{item.roomName} · {item.localStartTime.slice(0, 5)}–{item.localEndTime.slice(0, 5)} · {item.occurrenceCount} Termine</small></span><button className="text-button danger" onClick={() => void removeSchedule(item.id)}>Serie beenden</button></div>)}</div></section>}
      {canManagePlanning && <section className="content-card table-card"><div className="section-title-row"><div><p className="eyebrow">Einzeltermine</p><h2>Feiertage und Ausnahmen bearbeiten</h2></div><span className="count-badge">{data.appointments.filter((item) => item.status === "OPEN").length}</span></div><div className="table-scroll"><table className="appointment-table"><thead><tr><th>Datum</th><th>Zeit</th><th>Raum</th><th>Plätze</th><th>Gebucht</th><th>Aktion</th></tr></thead><tbody>{data.appointments.filter((item) => item.status === "OPEN").map((appointment) => <EditableAppointment appointment={appointment} key={appointment.id} reload={load} rooms={data.rooms} />)}</tbody></table></div></section>}
    </>}
    {message && <p className="status-box" role="status">{message}</p>}
  </>;
}

const statusLabels = { OPEN: "Noch offen", PLANNED: "Geplant", COMPLETED: "Erledigt", CANCELLED: "Abgemeldet" } as const;

type CoachStudent = TeacherCoachResponse["students"][number];

type ProgressCounts = {
  open: number;
  planned: number;
  completed: number;
};

function progressCounts(student: CoachStudent): ProgressCounts {
  return student.assessments.reduce<ProgressCounts>((counts, assessment) => {
    if (assessment.status === "OPEN") counts.open += 1;
    if (assessment.status === "PLANNED") counts.planned += 1;
    if (assessment.status === "COMPLETED") counts.completed += 1;
    return counts;
  }, { open: 0, planned: 0, completed: 0 });
}

function CoachStudentCard({ student, showTeam }: { student: CoachStudent; showTeam: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const counts = progressCounts(student);
  const detailId = `coach-student-details-${student.studentId}`;

  return <article className={`content-card coach-student${expanded ? " expanded" : ""}`}>
    <div className="coach-student-heading">
      <div className="coach-student-name">
        <p className="eyebrow">{showTeam ? student.teamName ?? "Ohne Team" : "Schüler*in"}</p>
        <h2>{student.displayName}</h2>
      </div>
      {student.assessments.length > 0 && <button
        aria-controls={detailId}
        aria-expanded={expanded}
        className="coach-detail-toggle"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span>{expanded ? "Details ausblenden" : "Details anzeigen"}</span>
        <span aria-hidden="true" className="coach-detail-chevron">⌄</span>
      </button>}
    </div>
    <div aria-label={`Stand für ${student.displayName}`} className="coach-progress-counts">
      <div className="open"><strong>{counts.open}</strong><span>offen</span></div>
      <div className="planned"><strong>{counts.planned}</strong><span>geplant</span></div>
      <div className="completed"><strong>{counts.completed}</strong><span>geschrieben</span></div>
    </div>
    {student.assessments.length === 0
      ? <p className="coach-no-assessments">Keine Gelingensnachweise zugeordnet.</p>
      : <ul className="coach-assessment-details" hidden={!expanded} id={detailId}>
        {student.assessments.map((assessment) => <li key={assessment.assessmentId}>
          <span className="coach-assessment-name">
            <strong>{assessment.subject} · {assessment.learningHouse}</strong>
            <small>{assessment.title}</small>
          </span>
          <span className={`state-pill ${assessment.status.toLowerCase()}`}>{statusLabels[assessment.status]}</span>
        </li>)}
      </ul>}
  </article>;
}

export function CoachView() {
  const [options, setOptions] = useState<{ teams: TeamSummary[]; appointments: AppointmentSummary[] } | null>(null);
  const [teamId, setTeamId] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<LoadState<TeacherCoachResponse>>({ status: "loading" });
  const [message, setMessage] = useState("");
  const [bookingStudentId, setBookingStudentId] = useState("");
  const [bookingAssessmentId, setBookingAssessmentId] = useState("");
  const [bookingAppointmentId, setBookingAppointmentId] = useState("");
  const [bookingComment, setBookingComment] = useState("");
  function load(selectedTeam = teamId) {
    setState({ status: "loading" });
    const suffix = selectedTeam ? `?teamId=${encodeURIComponent(selectedTeam)}` : "";
    void apiRequest<TeacherCoachResponse>(`/api/teacher/coach${suffix}`).then((data) => setState({ status: "ready", data })).catch((error: unknown) => setState({ status: "error", message: errorText(error, "Übersicht konnte nicht geladen werden.") }));
  }
  useEffect(() => { void apiRequest<{ teams: TeamSummary[]; appointments: AppointmentSummary[] }>("/api/teacher/coach/teams").then(setOptions); load(""); }, []);
  const data = state.status === "ready" ? state.data : null;
  const students = (data?.students ?? []).filter((student) => student.displayName.toLocaleLowerCase("de-DE").includes(query.toLocaleLowerCase("de-DE")));
  const bookings = (data?.bookings ?? []).filter((booking) => booking.studentName.toLocaleLowerCase("de-DE").includes(query.toLocaleLowerCase("de-DE")));
  const totals = students.reduce<ProgressCounts>((counts, student) => {
    const current = progressCounts(student);
    counts.open += current.open;
    counts.planned += current.planned;
    counts.completed += current.completed;
    return counts;
  }, { open: 0, planned: 0, completed: 0 });
  const selectedTeamName = options?.teams.find((team) => team.id === teamId)?.name;
  const bookingStudent = data?.students.find((student) => student.studentId === bookingStudentId);
  async function changeStatus(booking: TeacherBookingSummary, status: "PLANNED" | "COMPLETED" | "CANCELLED") {
    try { await apiRequest(`/api/teacher/coach/bookings/${booking.id}/status`, { method: "POST", body: JSON.stringify({ status, version: booking.version }) }); setMessage("Status wurde aktualisiert."); load(); }
    catch (error) { setMessage(errorText(error, "Status konnte nicht geändert werden.")); load(); }
  }
  async function bookForStudent(event: FormEvent) {
    event.preventDefault();
    try {
      await apiRequest("/api/teacher/coach/bookings", { method: "POST", body: JSON.stringify({ studentId: bookingStudentId, assessmentId: bookingAssessmentId, appointmentId: bookingAppointmentId, comment: bookingComment.trim() || null }) });
      setBookingComment("");
      setMessage("Die Anmeldung wurde für die Schüler*in eingetragen.");
      load();
    } catch (error) { setMessage(errorText(error, "Anmeldung konnte nicht eingetragen werden.")); }
  }
  return <>
    <div className="page-heading"><div><p className="eyebrow">Lerncoach-Übersicht</p><h1>Geplant oder schon erledigt?</h1><p>Sieh pro Schüler*in und Gelingensnachweis den aktuellen Stand.</p></div><div className="button-row no-print"><button className="secondary-button" onClick={() => void downloadAuthenticated(`/api/teacher/coach/export.csv${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ""}`, "GN-Anmeldungen.csv")}>CSV exportieren</button><button className="primary-button compact" onClick={() => window.print()}>Drucken / PDF</button></div></div>
    <section className="content-card coach-filters no-print"><label>Team<select value={teamId} onChange={(event) => { setTeamId(event.target.value); load(event.target.value); }}><option value="">Alle zugänglichen Teams</option>{options?.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label>Schüler*in suchen<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name eingeben" /></label></section>
    {state.status === "loading" && <p className="status-box">Lerncoach-Übersicht wird geladen …</p>}
    {state.status === "error" && <p className="status-box error">{state.message}</p>}
    {data && <>
      <section className="content-card coach-progress-overview no-print">
        <div className="coach-progress-heading">
          <div><p className="eyebrow">Planungsstand</p><h2>{selectedTeamName ?? "Alle zugänglichen Teams"}</h2><p>Die Details jeder Schüler*in lassen sich einzeln aufklappen.</p></div>
          <span className="count-badge">{students.length} {students.length === 1 ? "Schüler*in" : "Schüler*innen"}</span>
        </div>
        <div className="coach-summary-grid" aria-label="Zusammenfassung aller angezeigten Gelingensnachweise">
          <div className="open"><strong>{totals.open}</strong><span>noch offen</span></div>
          <div className="planned"><strong>{totals.planned}</strong><span>geplant</span></div>
          <div className="completed"><strong>{totals.completed}</strong><span>geschrieben</span></div>
        </div>
      </section>
      {students.length === 0
        ? <section className="content-card coach-empty no-print"><strong>Keine Schüler*innen gefunden</strong><span>Ändere die Teamsauswahl oder den Suchbegriff.</span></section>
        : <section aria-label="Fortschritt nach Schüler*in" className="coach-student-grid no-print">{students.map((student) => <CoachStudentCard key={student.studentId} showTeam={!teamId} student={student} />)}</section>}
      <section className="content-card no-print"><div className="section-title-row flush"><div><p className="eyebrow">Nachträglich eintragen</p><h2>Für eine Schüler*in buchen</h2></div></div><form className="coach-booking-form" onSubmit={bookForStudent}><label>Schüler*in<select required value={bookingStudentId} onChange={(event) => { setBookingStudentId(event.target.value); setBookingAssessmentId(""); }}><option value="">Auswählen</option>{data.students.map((student) => <option key={student.studentId} value={student.studentId}>{student.displayName}{!teamId && student.teamName ? ` · ${student.teamName}` : ""}</option>)}</select></label><label>Gelingensnachweis<select disabled={!bookingStudent} required value={bookingAssessmentId} onChange={(event) => setBookingAssessmentId(event.target.value)}><option value="">Auswählen</option>{bookingStudent?.assessments.map((assessment) => <option key={assessment.assessmentId} value={assessment.assessmentId}>{assessment.subject} · {assessment.learningHouse} · {assessment.title}</option>)}</select></label><label>Termin<select required value={bookingAppointmentId} onChange={(event) => setBookingAppointmentId(event.target.value)}><option value="">Auswählen</option>{options?.appointments.filter((appointment) => appointment.booked < appointment.capacity).map((appointment) => <option key={appointment.id} value={appointment.id}>{formatDate(appointment.startsAt)} · {formatTime(appointment.startsAt)} · {appointment.roomName}</option>)}</select></label><label>Kommentar<input value={bookingComment} onChange={(event) => setBookingComment(event.target.value)} placeholder="Optional" /></label><button className="primary-button" type="submit">Eintragen</button></form></section>
      <section className="content-card table-card print-section"><div className="section-title-row"><div><p className="eyebrow">Anmeldeliste</p><h2>Termine und Kommentare</h2></div><span className="count-badge">{bookings.length}</span></div>{bookings.length === 0 ? <div className="inline-empty"><strong>Keine Anmeldungen</strong><span>Für die Auswahl liegen noch keine Buchungen vor.</span></div> : <div className="table-scroll"><table><thead><tr><th>Schüler*in</th><th>Team</th><th>Termin</th><th>Raum</th><th>Nachweis</th><th>Kommentar</th><th>Status</th></tr></thead><tbody>{bookings.map((booking) => <tr key={booking.id}><td><strong>{booking.studentName}</strong></td><td>{booking.teamName ?? "–"}</td><td>{formatDate(booking.startsAt)}<br />{formatTime(booking.startsAt)}</td><td>{booking.roomName}</td><td>{booking.subject} · {booking.learningHouse}<br /><small>{booking.assessmentTitle}</small></td><td className="comment-cell">{booking.comment || "–"}</td><td><select className="status-select no-print" value={booking.status} onChange={(event) => void changeStatus(booking, event.target.value as "PLANNED" | "COMPLETED" | "CANCELLED")}><option value="PLANNED">Geplant</option><option value="COMPLETED">Erledigt</option><option value="CANCELLED">Abgemeldet</option></select><span className="print-only">{statusLabels[booking.status]}</span></td></tr>)}</tbody></table></div>}</section>
    </>}
    {message && <p className="status-box no-print" role="status">{message}</p>}
  </>;
}
