# App Planner 2

App Planner 2 ist ein schulinterner Planer für Gelingensnachweise (GN). Ein
Gelingensnachweis ist ein Test oder eine andere Leistungsüberprüfung, die einem
Fach und einem Lernhaus/Niveau zugeordnet wird. Schüler*innen buchen dafür einen
Termin in einem Raum; Lehrkräfte planen die Angebote und verfolgen den Stand
ihrer Teams.

Die Anwendung besteht aus einer React-Oberfläche, einer Node.js-API und
PostgreSQL. Im normalen Betrieb laufen alle drei Teile als Docker-Dienste. Auf
einem Serverrechner werden deshalb weder Node.js noch pnpm benötigt.

> **Wichtig für den Schuleinsatz:** Der direkte Start im lokalen Netz verwendet
> zunächst HTTP. Solange kein HTTPS und kein abgestimmtes Datenschutz-,
> Lösch- und Sicherungskonzept eingerichtet ist, dürfen nur erfundene
> Testpersonen verwendet werden.

## Funktionsumfang

- getrennte Ansichten für Schüler*innen und Lehrkräfte
- Anmeldung mit kurzer Schul-ID und Passwort; keine öffentliche Registrierung
- persönliche Passwortänderung und erzwungene Änderung des Erstkennworts
- Teams, einzelne Schülerkonten, Sammeleinrichtung und CSV-Zugangslisten
- zeitlich und mengenmäßig begrenzte Einladungslinks mit QR-Code
- Räume mit eigener Kapazität, GN-Definitionen und wöchentliche Terminserien
- einzeln änder- oder entfernbar erzeugte Termine, etwa für Feiertage
- genau ein GN je Buchung sowie konfigurierbare An- und Abmeldefristen
- Schutz vor Doppelbuchungen und Überbelegung auch bei gleichzeitigen Zugriffen
- Schüleransicht nach Kalenderwochen mit Buchung, Übersicht und Abmeldung
- Lerncoach-Übersicht mit Teamfilter, Suche und den Summen `offen`, `geplant`
  und `geschrieben`; die GN-Details jeder Person sind einzeln ein- und ausklappbar
- Buchung und Statuspflege durch zuständige Lehrkräfte
- CSV-Export und druckoptimierte Ansicht für den PDF-Druck im Browser
- markierter Demonstrationsbestand, der getrennt zurückgesetzt oder gelöscht
  werden kann
- Audit-Log für wesentliche Konto-, Buchungs- und Statusänderungen
- automatische, geprüfte PostgreSQL-Sicherungen

## Konten, Rollen und Rechte

Es gibt zwei technische Rollen: `STUDENT` und `TEACHER`. Lehrkraftrechte werden
zusätzlich einzeln in der Datenbank gespeichert und bei jeder geschützten
Anfrage serverseitig geprüft.

### Administration

- Es muss immer mindestens ein aktives Administrationskonto geben.
- Es sind höchstens zwei aktive Administrationskonten möglich.
- Administration bedeutet Kontenverwaltung und schließt alle weiteren
  Lehrkraftrechte ein.
- Das eigene Administrationskonto kann nicht versehentlich deaktiviert oder zum
  normalen Lehrkraftkonto herabgestuft werden.
- Nur die Administration kann weitere Lehrkraftkonten anlegen und deren Rechte
  und Teamzuordnungen festlegen.

### Lehrkräfte und Lerncoaches

Einer Lehrkraft können eines oder mehrere Teams und unabhängig voneinander diese
Rechte zugeteilt werden:

- **Teams verwalten:** Teams, Schülerkonten, Zugangslisten und Einladungen der
  zugewiesenen Teams verwalten
- **Gelingensnachweise verwalten:** GN-Definitionen und Anforderungen der
  zugewiesenen Teams pflegen
- **Terminplanung verwalten:** Räume, Wochenserien, Einzeltermine und Fristen
  verwalten

Ein Lehrkraftkonto ohne Administrationsrecht benötigt mindestens ein
zugewiesenes Team. Auch ohne zusätzliche Verwaltungsrechte hat es für diese
Teams die Lerncoach-Übersicht. Dort sieht die Lehrkraft zunächst kompakte
Statuszahlen und kann nur bei Bedarf die einzelnen GN einer Schülerin oder eines
Schülers aufklappen.

### Schüler*innen

Schülerkonten können nur ihre eigenen Termine und Buchungen sehen. Sie dürfen
innerhalb der eingestellten Fristen buchen und stornieren und ihr eigenes
Passwort ändern.

## Schnellstart unter Windows

### Voraussetzung

Auf dem Windows-Rechner muss nur **Docker Desktop** installiert sein. Docker
Desktop bringt Docker Compose mit. Node.js, pnpm und eine lokale
PostgreSQL-Installation sind für den normalen Start nicht nötig.

Der erste Start auf einem neuen Rechner benötigt Internetzugang, weil
Docker-Images und Programmpakete geladen und das Anwendungsabbild gebaut werden.
Spätere Starts können den vorhandenen Docker-Cache verwenden.

### Start für Geräte im gleichen Netzwerk

1. `Start-App-Planner-2.cmd` doppelklicken.
2. Docker Desktop wird bei Bedarf gestartet.
3. Der Starter erzeugt beim ersten Lauf die Serverkonfiguration `.env.server`, baut
   die Anwendung, startet PostgreSQL und spielt alle Migrationen ein.
4. Nur wenn die Datenbank noch **kein einziges Lehrkraftkonto** enthält, fragt
   der Starter interaktiv nach ID, Anzeigename und Passwort für den ersten
   Administrator. Das Passwort wird nicht in `.env.server` gespeichert.
5. Der Browser öffnet die ermittelte Netzwerkadresse, beispielsweise
   `http://192.168.1.50:3001`.

Die Docker-Dienste laufen anschließend im Hintergrund weiter. Das schwarze
Startfenster darf geschlossen werden. Tablets und andere Rechner im gleichen
Netz verwenden die angezeigte Adresse.

Windows-Firewall, VLAN-Regeln oder WLAN-Client-Isolation können den Zugriff
trotz korrektem Start verhindern. Port 3001 sollte nur für das vorgesehene
Schulnetz freigegeben werden. Für einen dauerhaft erreichbaren Server ist eine
DHCP-Reservierung oder eine feste Serveradresse sinnvoll. PostgreSQL selbst
wird im normalen Compose-Betrieb nicht als Netzwerkport des Rechners
veröffentlicht; Endgeräte greifen ausschließlich auf die Webanwendung zu.

### Test nur auf diesem Rechner

`App-lokal-testen.cmd` startet dieselbe Anwendung, bindet Port 3001 aber nur an
`127.0.0.1`. Die Seite ist dann unter <http://localhost:3001> ausschließlich auf
diesem Rechner vorgesehen. Diese Variante ist die richtige Wahl für einen
lokalen Funktionstest.

**Lokal bedeutet nur „nicht aus dem Netzwerk erreichbar“.** Der lokale Starter
verwendet dieselben Container und dasselbe echte PostgreSQL-Volume wie der
Netzwerkstarter. Angelegte, geänderte oder gelöschte Daten sind daher dauerhaft
und beim nächsten Netzwerkstart ebenfalls vorhanden. Es handelt sich nicht um
eine getrennte Testdatenbank und es findet kein automatischer Reset statt.

Auf einem Rechner darf immer nur **eine** Kopie des App-Planner-Ordners aktiv
gestartet werden. Der feste Compose-Projektname `appplanner2` sorgt dafür, dass
alle Ordnerkopien auf diesem Rechner dieselben Container und dasselbe
Datenbank-Volume ansprechen würden. Eine zweite Kopie ist deshalb keine
unabhängige Instanz.

### Sauber beenden

`App-Planner-2-stoppen.cmd` beendet Anwendung und Datenbank kontrolliert. Dabei
erhält die Anwendung Zeit für eine Abschlusssicherung. Datenbank-Volume,
Konfiguration und Sicherungen bleiben erhalten.

Nicht `docker compose down -v` verwenden: `-v` würde das Datenbank-Volume
löschen.

## Start unter Linux oder auf einem Raspberry Pi

Für einen Raspberry Pi ist **64-Bit Raspberry Pi OS erforderlich**; das aktuelle
Node-Docker-Image unterstützt dort `arm64`, nicht das ältere 32-Bit-`arm/v7`.
Benötigt werden Docker Engine und das Docker-Compose-Plugin; der verwendete
Benutzer muss Docker ausführen dürfen.

```sh
chmod +x Start-Server-Linux.sh Stop-Server-Linux.sh
./Start-Server-Linux.sh
```

Der Starter ermittelt die Netzwerkadresse, erzeugt `.env.server`, baut das zur
Rechnerarchitektur passende Docker-Image und richtet bei einer leeren Datenbank interaktiv den
ersten Administrator ein. Auch hier benötigt der erste Build Internetzugang.
Der Dienst läuft danach im Hintergrund.

Zum kontrollierten Beenden:

```sh
./Stop-Server-Linux.sh
```

Für einen reinen Loopback-Test kann auch unter Linux
`./Start-Server-Linux.sh --local` verwendet werden.

Liegt der Projektordner oder der Sicherungsspiegel auf einem USB-Laufwerk, muss
dieses stabil und immer unter demselben Pfad eingehängt sein. Beim Booten muss
der Mount verfügbar sein, bevor Docker die automatisch neu startenden Container
lädt. Andernfalls kann der Start wegen des nicht beschreibbaren
Sicherungsordners scheitern. Für einen unbeaufsichtigten Pi-Server ist ein
interner Datenträger oder eine ausdrücklich konfigurierte Mount-Abhängigkeit
zuverlässiger.

## Verwendung von einem USB-Stick

Der gesamte Projektordner kann auf einen USB-Stick kopiert und auf einem anderen
Windows-Rechner mit Docker Desktop gestartet werden. Dabei gelten wichtige
Grenzen:

- Programmdateien, `.env.server` und `data/Sicherungen` liegen im Projektordner
  und werden mitkopiert.
- Die **laufende PostgreSQL-Datenbank liegt in einem benannten Docker-Volume des
  jeweiligen Rechners**. Sie liegt nicht im Projektordner und wird durch eine
  USB-Kopie nicht automatisch übertragen.
- Auf einem anderen Rechner entsteht daher ohne Wiederherstellung eine neue,
  leere Datenbank. Ein bestehender Datenstand muss über eine `.dump`-Sicherung
  wiederhergestellt werden.
- Der USB-Stick muss während des Betriebs angeschlossen und für Docker
  zugreifbar bleiben, weil der Sicherungsordner von dort in den Container
  eingebunden ist. Vor dem Abziehen **immer** zuerst den Stop-Launcher ausführen
  und dessen Abschluss abwarten.
- Docker-Images werden nicht mit dem Projektordner kopiert. Der erste Start auf
  dem Zielrechner benötigt deshalb in der Regel erneut Internetzugang.

`.env.server` enthält Datenbank- und Sitzungsschlüssel. Die Datei muss wie ein
Passwort behandelt, vor unbefugtem Zugriff geschützt und darf nicht per
ungeschützter E-Mail oder Messenger versendet werden.

### Aktueller OneDrive-Speicherort

Der Projektordner liegt derzeit innerhalb von OneDrive. Dadurch können sowohl
`.env.server` als auch die Datenbank-Dumps unter `data/Sicherungen` automatisch
in eine Cloud synchronisiert werden. Beide enthalten sensible Daten. **Vor der
Verwendung echter Schülerdaten muss der gesamte Projektordner nach einem
kontrollierten Stop auf einen nicht cloud-synchronisierten, schulisch
verwalteten und verschlüsselten Speicher verschoben werden.** Danach den
normalen Starter aus dem neuen Ordner ausführen und die Sicherungspfade prüfen.

Auch auf dem neuen Speicherort gilt: keine zweite Ordnerkopie auf demselben
Rechner parallel starten.

## Serverkonfiguration

Die Starter erzeugen und aktualisieren `.env.server`. Die automatisch
ermittelten Felder werden bei jedem Start aktualisiert; die unten beschriebenen
`*_OVERRIDE`- und Spiegel-Einstellungen bleiben erhalten. Nach einer Änderung
den passenden Starter erneut ausführen.

Der lokale Start ignoriert die URL-, Origin- und Bind-Overrides absichtlich und
setzt immer `http://localhost:3001`, die beiden lokalen Browser-Ursprünge sowie
`127.0.0.1` als Bind-Adresse. Die Overrides gelten erst wieder beim
Netzwerkstarter.

Existiert auf einem Rechner bereits das Docker-Volume mit der Datenbank, aber
`.env.server` fehlt oder enthält kein Datenbankkennwort, bricht der Starter zum
Schutz der Daten ab. Er errät oder überschreibt das Kennwort nicht. In diesem
Fall `.env.server` aus der geschützten Konfigurationssicherung wiederherstellen;
das Volume nicht löschen. Die automatischen `.dump`-Dateien enthalten
`.env.server` nicht, deshalb muss auch diese Datei separat verschlüsselt
gesichert werden.

| Einstellung | Bedeutung |
| --- | --- |
| `PUBLIC_URL` | vom Starter aktuell verwendete öffentliche Adresse |
| `WEB_ORIGINS` | erlaubte Browser-Ursprünge |
| `APP_BIND_ADDRESS` | `0.0.0.0` im Netzwerkbetrieb, `127.0.0.1` beim lokalen Test |
| `PUBLIC_URL_OVERRIDE` | optionale feste HTTP(S)-Adresse, etwa `https://gn-planer.schule.example` |
| `WEB_ORIGINS_OVERRIDE` | optionale, kommaseparierte Liste erlaubter Ursprünge |
| `APP_BIND_ADDRESS_OVERRIDE` | optional `0.0.0.0` oder `127.0.0.1` |
| `TRUST_PROXY` | nur bei einem kontrollierten Reverse-Proxy auf `true` setzen |
| `BACKUP_MIRROR_HOST_DIRECTORY` | vorhandener Ordner für eine zweite Sicherungskopie |

Beispiel für einen HTTPS-Reverse-Proxy auf demselben Server:

```dotenv
PUBLIC_URL_OVERRIDE=https://gn-planer.schule.example
WEB_ORIGINS_OVERRIDE=https://gn-planer.schule.example
APP_BIND_ADDRESS_OVERRIDE=127.0.0.1
TRUST_PROXY=true
```

Läuft der Reverse-Proxy auf einem anderen Rechner, darf die Anwendung nicht auf
Loopback beschränkt werden; dann müssen Firewall und Proxy-Netz stattdessen
gezielt abgesichert werden.

`TRUST_PROXY=true` darf **ausschließlich hinter einem vertrauenswürdigen,
kontrollierten Reverse-Proxy** gesetzt werden. Ohne einen solchen Proxy muss der
Wert zwingend `false` bleiben. Die Proxy- und Login-Limits müssen vor dem
Mehrgerätebetrieb praktisch geprüft werden.

## HTTPS und Datenschutz

Für echte Schülerdaten gehört ein HTTPS-Reverse-Proxy vor die Anwendung. Der
Proxy übernimmt das TLS-Zertifikat und leitet intern an Port 3001 weiter. Die
öffentliche HTTPS-Adresse muss über `PUBLIC_URL_OVERRIDE` und
`WEB_ORIGINS_OVERRIDE` eingetragen werden.

Vor der Freigabe sind mindestens zu klären:

- Rechtsgrundlage, Verantwortlichkeiten und Zugriffsberechtigungen
- Aufbewahrungs-, Lösch- und Ausscheideregeln
- Firewall, Netzwerksegmentierung und Serverupdates
- verschlüsseltes externes Sicherungsziel
- dokumentierte und regelmäßig getestete Wiederherstellung
- sicherer Umgang mit CSV-Dateien, Erstkennwörtern und `.env.server`

## Sicherungen

Im Docker-Betrieb werden Sicherungen sichtbar im Projektordner abgelegt:

```text
data/Sicherungen/gn-planer_JJJJ-MM-TT_HH-MM-SS.dump
```

Die Anwendung erstellt eine Sicherung kurz nach dem Start, danach alle zehn
Minuten und beim kontrollierten Beenden. Jeder Dump wird mit `pg_restore --list`
geprüft, bevor er als gültig übernommen wird. Lokal bleiben die neuesten 30
Dateien erhalten. Bei Dauerbetrieb decken 30 Zehn-Minuten-Stände nur ungefähr
fünf Stunden ab; zusätzliche Tages- und Wochenstände sind deshalb erforderlich.

### Zweites Sicherungsziel

In `.env.server` kann ein bereits vorhandener Ordner angegeben werden:

```dotenv
BACKUP_MIRROR_HOST_DIRECTORY=D:\GN-Planer-Sicherungskopie
```

Unter Linux ist entsprechend ein absoluter Linux-Pfad zu verwenden. Bei jedem
gültigen lokalen Dump wird eine Kopie dorthin geschrieben. Ist das Ziel beim
Start nicht erreichbar, läuft die lokale Sicherung weiter und der Starter zeigt
eine Warnung. Beim Containerstart wird außerdem praktisch geprüft, ob die App in
den lokalen Sicherungsordner und in den Spiegelordner schreiben kann. Ein nicht
beschreibbarer Hauptordner verhindert den App-Start; bei einem nicht
beschreibbaren Spiegel bleibt die lokale Sicherung aktiv und es erscheint eine
Warnung. Das Spiegelziel hat keine automatische 30-Dateien-Begrenzung und
benötigt eine eigene Aufbewahrungs- und Löschregel.

Der Sicherungsstatus ist für die Administration unter `Einstellungen` sichtbar.
Eine erfolgreiche Dateiprüfung ersetzt keine echte Wiederherstellungsprobe.

## Sicherung wiederherstellen

Eine Wiederherstellung ersetzt den aktuellen Datenbestand. Vorher eine
zusätzliche Sicherung erstellen und die Schritte an einer Testinstallation
erproben. Die Wiederherstellung sollte eine technisch verantwortliche Person
durchführen.

Beispiel mit `SICHERUNG.dump` im Projektordner:

```powershell
docker compose --env-file .env.server -f docker-compose.yml stop app
docker compose --env-file .env.server -f docker-compose.yml cp .\SICHERUNG.dump postgres:/tmp/restore.dump
docker compose --env-file .env.server -f docker-compose.yml exec -T postgres dropdb --if-exists --force -U gn_planer gn_planer
docker compose --env-file .env.server -f docker-compose.yml exec -T postgres createdb -U gn_planer -O gn_planer gn_planer
docker compose --env-file .env.server -f docker-compose.yml exec -T postgres pg_restore -U gn_planer -d gn_planer --no-owner --no-privileges /tmp/restore.dump
docker compose --env-file .env.server -f docker-compose.yml exec -T postgres rm -f /tmp/restore.dump
```

Danach den normalen Windows- oder Linux-Starter ausführen. Er aktiviert auch
einen konfigurierten Sicherungsspiegel wieder und spielt neuere Migrationen
automatisch ein. Anschließend Login, Teamzahlen und einige Buchungen prüfen. Für
die Übernahme auf einen anderen Rechner sollten Projektordner, die zugehörige
`.env.server` und der gewünschte Dump gemeinsam gesichert übertragen werden.

## Demonstrationsdaten

Die Administration findet unter `Einstellungen` den Bereich
`Demodaten verwalten`. Dort lassen sich frei erfundene Teams, Räume,
Schülerkonten, GN, Termine und Buchungen anlegen, auf den Ausgangszustand
zurücksetzen oder vollständig löschen.

Die Datensätze sind intern markiert. Verknüpfen echte Daten die Demodatensätze,
bricht das Löschen ab, statt echte Daten mitzulöschen. Beim Anlegen oder
Zurücksetzen entstehen neue, einmalig sichtbare Erstkennwörter. Eine ältere
Zugangsliste ist danach ungültig.

## Wartung und Diagnose

- Vor Updates immer eine aktuelle Sicherung und möglichst einen externen Spiegel
  kontrollieren.
- Danach den Projektstand aktualisieren und den normalen Starter erneut
  ausführen; er baut das App-Image und führt Migrationen aus.
- Basisimages sollten geplant und nach Test aktualisiert werden, nicht
  unkontrolliert während des Schulbetriebs.
- Containerstatus: `docker compose --env-file .env.server -f docker-compose.yml ps`
- letzte App-Meldungen: `docker compose --env-file .env.server -f docker-compose.yml logs --tail 100 app`
- Images bewusst aktualisieren:

  ```powershell
  docker compose --env-file .env.server -f docker-compose.yml pull postgres
  docker compose --env-file .env.server -f docker-compose.yml build --pull app
  ```

  Danach den normalen Starter verwenden und die wichtigsten Abläufe prüfen.

## Entwicklung

Dieser Abschnitt ist nur für Entwickler*innen. Für den normalen Serverstart ist
er nicht erforderlich. Benötigt werden Node.js 22 oder neuer und pnpm. Vorher
müssen eigene `apps/api/.env`- und `apps/web/.env`-Dateien anhand der
Beispieldateien eingerichtet werden. Die `DATABASE_URL` muss zum Kennwort der
separaten Entwicklungsdatenbank passen.

Das Entwicklungs-Compose-Overlay veröffentlicht PostgreSQL ausschließlich auf
`127.0.0.1:5432`. Ein eigener Projektname verhindert, dass dabei das
Produktiv-Volume verwendet wird:

```powershell
docker compose -p appplanner2-dev --env-file .env.server -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
pnpm install
pnpm db:setup
pnpm dev
```

- Frontend: <http://localhost:5173>
- API-Status: <http://localhost:3001/api/health>

Integrationstests verändern Daten und dürfen nur gegen eine separate
Testdatenbank laufen:

```powershell
$env:RUN_DATABASE_TESTS="true"
pnpm --filter @gn-planer/api test
```

Für einen begleiteten Testtag gibt es die
[`PILOT-CHECKLISTE.md`](./PILOT-CHECKLISTE.md).
