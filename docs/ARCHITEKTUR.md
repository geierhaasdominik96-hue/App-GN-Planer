# Architekturentscheidungen

## Vertrauensgrenzen

Das React-Frontend ist nicht vertrauenswürdig. Es darf Menüpunkte ausblenden,
aber niemals Berechtigungen vergeben. Die API ermittelt zu jeder geschützten
Anfrage die Better-Auth-Sitzung und lädt anschließend das aktive fachliche Profil
aus PostgreSQL.

## Konten und Rollen

Better Auth besitzt die Tabellen `user`, `session`, `account` und
`verification`. Dort liegen Login-ID, Passwort-Hash und Sitzungen. Das
Fachmodell referenziert `user.id` über `app_users.auth_user_id`.

Die Trennung in `student_profiles` und `teacher_profiles` hält fachlich
unterschiedliche Felder auseinander. Eine zusätzliche Rollenprüfung per Trigger
sichert diese Trennung unabhängig vom Anwendungscode. Das Masterkonto ist eine
Lehrkraft mit `can_manage_accounts = true`; das ist erweiterbarer als ein
festcodierter Benutzername.

Anmelde-IDs werden lesbar aus dem Namen gebildet und bei Dopplungen um
eine Zahl ergänzt werden. Startpasswörter werden bewusst **nicht** aus Namen
abgeleitet: Sie müssen zufällig erzeugt, einzeln ausgegeben und nach der ersten
Anmeldung geändert werden. `student_profiles.must_change_password` hält diesen
Zustand fest. Das vermeidet leicht erratbare Zugangsdaten zwischen
Mitschüler*innen.

## Gleichzeitige Buchungen

Alle Raumtermine zur gleichen Start-/Endzeit können denselben
`time_slots`-Datensatz referenzieren. Zusätzlich prüft ein Datenbank-Trigger
beliebige zeitliche Überschneidungen. Ein Advisory Lock pro Schüler*in sorgt
dafür, dass auch zwei gleichzeitig eintreffende Buchungen in verschiedenen
Räumen nicht beide erfolgreich sein können.

Vor dem Anlegen einer aktiven Buchung sperrt der Datenbank-Trigger den betroffenen
Termin mit `FOR UPDATE` und zählt dessen aktive Buchungen. Gleichzeitige Zugriffe
werden dadurch für genau diesen Termin serialisiert. Die Kapazitätsregel bleibt
auch dann wirksam, wenn später ein zweiter API-Endpunkt hinzukommt.

## Migrationen und Betrieb

Better Auth migriert nur sein eigenes Schema. Die Fachmigrationen sind
unveränderliche SQL-Dateien mit SHA-256-Prüfsumme. Ein PostgreSQL Advisory Lock
verhindert, dass zwei Serverinstanzen dieselbe Migration gleichzeitig anwenden.

PostgreSQL ist auf dem lokalen Pilotserver ausschließlich an `127.0.0.1`
gebunden. In einem zentralen Produktionsbetrieb werden Kennwörter und
Auth-Secret über einen Secret Store gesetzt und HTTP durch einen
HTTPS-Reverse-Proxy ersetzt.
