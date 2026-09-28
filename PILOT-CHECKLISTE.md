# Pilot-Checkliste für App Planner 2

Diese Checkliste ist für einen begleiteten Test gedacht. Solange die Adresse mit
`http://` beginnt, nur erfundene Testpersonen und keine echten Schülerdaten
verwenden.

## Vor dem Testtag

- Serverrechner ans Netzteil anschließen und automatischen Energiesparmodus für
  den Testzeitraum ausschalten.
- Docker Desktop unter Windows beziehungsweise Docker Engine mit Compose-Plugin
  unter Linux starten und prüfen.
- Beim ersten Start auf diesem Rechner Internetzugang für Image- und
  Paketdownloads einplanen.
- Für den Netzwerkversuch `Start-App-Planner-2.cmd` doppelklicken. Nur für einen
  Test auf demselben Windows-PC `App-lokal-testen.cmd` verwenden.
- Beachten: Der lokale Starter verwendet dieselbe echte Docker-Datenbank wie
  der Netzwerkstarter. Änderungen und Löschungen bleiben erhalten; es gibt
  keine automatisch zurückgesetzte Testdatenbank.
- Sicherstellen, dass auf diesem Rechner keine zweite Kopie des Projektordners
  gestartet ist. Durch den festen Compose-Projektnamen würden beide Kopien
  dieselben Container und dasselbe Volume verwenden.
- Warten, bis der Browser geöffnet und die Bereitschaftsmeldung angezeigt wird.
  Das Startfenster darf danach geschlossen werden; die Docker-Dienste laufen im
  Hintergrund.
- Die Netzwerkadresse notieren. Sie muss für den Mehrgerätetest eine erreichbare
  IP oder HTTPS-Domain und nicht `localhost` enthalten.
- Firewallfreigabe für Port 3001 auf das Testnetz begrenzen und prüfen, ob das
  WLAN die direkte Kommunikation der Geräte erlaubt.
- `.env.server` nicht versenden oder offen ablegen; die Datei enthält
  Servergeheimnisse.
- Eine verschlüsselte Konfigurationssicherung von `.env.server` bereithalten.
  Fehlt die Datei bei einem bereits vorhandenen Datenbank-Volume, bricht der
  Starter absichtlich ab; das Volume dann nicht löschen, sondern die
  Konfiguration wiederherstellen.
- Der aktuelle Projektordner liegt unter OneDrive. Vor Tests mit echten
  Schülerdaten Anwendung stoppen und den Ordner auf einen nicht
  cloud-synchronisierten, schulisch verwalteten und verschlüsselten Speicher
  verschieben. Auch `.env.server` und `data/Sicherungen` sind sensibel.
- Die im Browser und in der Bereitschaftsmeldung angezeigte Adresse vergleichen.
- Im Administrationskonto unter `Einstellungen` kontrollieren:
  - Betriebsmodus und Verbindungstyp
  - aktuelle, erfolgreiche Sicherung
  - ob das optionale zweite Sicherungsziel als eingerichtet angezeigt wird
  - bei HTTP: weiterhin ausschließlich Testdaten
- Mindestens diese Testdaten vorbereiten:
  - zwei Teams und je zwei Test-Schüler*innen
  - zwei Lehrkraftkonten mit unterschiedlichen Teamzuordnungen
  - mindestens eine Lehrkraft mit Teamverwaltung und eine mit Terminplanung
  - zwei Räume mit unterschiedlichen Kapazitäten
  - mehrere Gelingensnachweise
  - eine Wochenserie mit mindestens zwei zukünftigen Terminen
- Prüfen, dass ein oder zwei aktive Administrationskonten vorhanden sind. Ein
  drittes aktives Administrationskonto darf nicht angelegt werden können.

Falls der Projektordner direkt von einem USB-Stick läuft, muss der Stick während
des gesamten Tests verbunden bleiben. Die Datenbank selbst liegt im
Docker-Volume des Serverrechners; die sichtbaren Sicherungen liegen auf dem
Stick im Ordner `data/Sicherungen`. Auf einem Raspberry Pi muss der Stick vor
dem automatischen Docker-Start zuverlässig unter demselben Pfad eingehängt sein.

Für einen Raspberry Pi vorab bestätigen, dass ein 64-Bit Raspberry Pi OS läuft;
32-Bit-`arm/v7` wird vom aktuellen Node-Image nicht unterstützt.

## Konten und Rechte prüfen

1. Mit dem Administrationskonto anmelden und kontrollieren, dass
   Kontenverwaltung, Teams, GN-Planung und Terminplanung sichtbar sind.
2. Ein Lehrkraftkonto ohne Administrationsrecht öffnen:
   - Es darf nur zugewiesene Teams sehen.
   - Zusätzliche Bereiche dürfen nur erscheinen, wenn das entsprechende Recht
     erteilt wurde.
   - Ein Lehrkraftkonto ohne Teamzuordnung muss abgelehnt werden.
3. Mit einem neuen Schülerkonto und Erstkennwort anmelden. Vor der
   Passwortänderung dürfen nur die erforderlichen Kontoeinstellungen zugänglich
   sein.
4. Passwort ändern und erneut anmelden. Danach müssen eigene Übersicht und
   Terminbuchung erscheinen.
5. Prüfen, dass Schüler*innen keine fremden Konten, Teams oder Buchungen sehen.

## Lerncoach-Übersicht prüfen

1. Mit jedem Lerncoach-Konto die zugewiesenen Teams öffnen.
2. Teamfilter und Suche verwenden.
3. Kontrollieren, dass die Summen `offen`, `geplant` und `geschrieben` je Person
   plausibel sind.
4. Eine Schülerkarte aufklappen, einzelne GN und Status prüfen und wieder
   einklappen.
5. In der Ansicht `Alle Teams` kontrollieren, dass gleichnamige Schüler*innen
   durch ihre Teamangabe unterscheidbar sind.
6. Buchung und Statusänderung als Lerncoach testen; ein nicht zugewiesenes Team
   darf nicht bearbeitet werden.

## Buchung mit zwei oder mehr Geräten prüfen

1. Die Netzwerkadresse gleichzeitig auf einem Windows-Gerät und einem
   Apple-/Android-Tablet öffnen.
2. Mit zwei Testkonten gleichzeitig den letzten freien Platz buchen. Nur eine
   Buchung darf erfolgreich sein.
3. Für dieselbe Person zur selben Zeit einen Termin in einem anderen Raum
   buchen. Die Doppelbuchung muss verhindert werden.
4. Prüfen, dass je Buchung genau ein GN gewählt werden kann.
5. In der Verwaltung zwei überlappende Termine im selben Raum anlegen. Der
   zweite Termin muss abgelehnt werden.
6. Eine Wochenserie mit vorhandener Anmeldung beenden. Der Termin darf nicht
   mehr neu buchbar sein; die vorhandene Anmeldung muss in den Übersichten
   erhalten bleiben.
7. Anmeldefrist, fristgerechte Abmeldung und gesperrte Abmeldung innerhalb der
   Abmeldefrist prüfen.
8. CSV-Export herunterladen, inhaltlich prüfen und anschließend kontrolliert
   vom Testgerät löschen.
9. Druckansicht öffnen und testweise über den Browser als PDF speichern.
10. Auf einem normalen Tablet und einem schmalen Browserfenster prüfen, dass
    Navigation, Tabellen, Karten und Schaltflächen lesbar bleiben und kein Text
    unbedienbar über andere Elemente hinausragt.

## Sicherung und Neustart prüfen

1. Im Administrationskonto Zeitpunkt und Dateiname der letzten Sicherung
   kontrollieren.
2. Im Projektordner prüfen, ob die Datei unter `data/Sicherungen` vorhanden ist.
3. Bei eingerichtetem Spiegel kontrollieren, ob dort dieselbe Datei angekommen
   ist.
4. Mit dem in der README genannten Log-Befehl prüfen, dass die Schreibtests für
   Haupt- und Spiegelordner keine Warnung oder Fehlermeldung erzeugen.
5. `App-Planner-2-stoppen.cmd` beziehungsweise `./Stop-Server-Linux.sh`
   ausführen und das kontrollierte Ende abwarten.
6. Den normalen Netzwerkstarter erneut ausführen. Konten, Termine und Buchungen
   müssen unverändert vorhanden sein.
7. Eine Wiederherstellung aus einem Test-Dump vor dem Echtbetrieb einmal auf
   einer separaten Testinstallation durchführen und dokumentieren.

Einen USB-Stick **immer erst nach dem vollständigen Stoppen** sicher auswerfen.

## Nach dem Test

- Auffälligkeiten mit Uhrzeit, Konto, Gerät, Browser und ausgeführtem Schritt
  notieren; keine Passwörter in das Protokoll schreiben.
- Letzte erfolgreiche lokale und externe Sicherung kontrollieren.
- Testkonten deaktivieren oder vor einem späteren Echtbetrieb löschen beziehungsweise
  anonymisieren.
- CSV-Dateien und testweise erzeugte PDFs von allen Geräten kontrolliert löschen.
- Den Server mit dem vorgesehenen Stop-Launcher beenden, falls er nicht weiter
  benötigt wird.

## Freigabe für echte Schülerdaten

Vor der Freigabe müssen mindestens HTTPS, eine auf das erforderliche Netz
begrenzte Firewallregel, aktuelle Server- und Containerkomponenten, ein
verschlüsseltes zweites Sicherungsziel, eine erfolgreiche
Wiederherstellungsprobe sowie das abgestimmte Datenschutz- und Löschkonzept
vorliegen.
