# SP Nextcloud Plugins

Bidirektionale Nextcloud-Integrationen für [Super Productivity](https://github.com/johannesjo/super-productivity), als Plugins statt Core-Patches.

## Plugins

### 🔷 `deck-issue-provider`

Nextcloud Deck Karten bidirektional mit SP syncen.

| Feature | Status |
|---------|--------|
| Karten importieren (ausgewählte Stacks) | ✅ |
| Titel syncen | ✅ both |
| Beschreibung syncen | ✅ both |
| Erledigt-Status syncen | ✅ both |
| Fälligkeitsdatum syncen | ✅ both |
| **Karten anlegen** (createIssue) | ✅ **Besser als built-in!** |
| Karten löschen | ✅ |
| Labels/Assignees anzeigen | ✅ read-only |
| Dynamische Board-/Stack-Auswahl | ✅ via loadOptions |

**Config:**
- `serverUrl` — Nextcloud-URL
- `username`, `password` — App-Passwort
- `boardId` — Live aus Deck-API geladen
- `importStackIds` — Welche Stacks importiert werden (multiSelect)
- `defaultStackId` — Ziel-Stack für neue Karten

### 🔶 `caldav-task-provider`

CalDAV VTODO-Aufgaben (Nextcloud Tasks, Apple Reminders etc.) bidirektional syncen.

| Feature | Status |
|---------|--------|
| Aufgaben importieren | ✅ |
| Titel syncen | ✅ both |
| Beschreibung syncen | ✅ both |
| Erledigt syncen | ✅ both |
| Fälligkeit (mit/ohne Uhrzeit) syncen | ✅ both |
| Geschätzte Dauer syncen | ✅ pullOnly |
| **Aufgaben anlegen** (createIssue) | ✅ **Besser als built-in!** |
| Aufgaben löschen | ✅ |
| Kalender-Auswahl | ✅ via PROPFIND + loadOptions |
| PRIORITY syncen | ❌ API-Limit (taskField eingeschränkt) |
| CATEGORIES (Tags) syncen | ❌ API-Limit |
| LOCATION syncen | ❌ API-Limit |
| Subtasks (RELATED-TO) syncen | ❌ API-Limit |

**Config:**
- `serverUrl` — CalDAV Server URL
- `username`, `password` — App-Passwort
- `calendarHref` — Live per PROPFIND geladen

## Installation

```bash
# 1. Bauen
cd deck-issue-provider
npm install
npm run build
npm run package       # → dist/plugin.zip

# 2. In SP installieren
# Settings → Plugins → Upload Plugin → plugin.zip auswählen

# 3. Projekt-Konfiguration
# Work view → "+" → "Add project connected to issue provider"
# → "Deck" oder "Tasks" auswählen → Server/User/Board konfigurieren
```

Oder ZIP direkt von GitHub Releases herunterladen.

## Entwicklung

```bash
# Dependencies
npm install

# TypeScript prüfen
npm run typecheck

# Bauen
npm run build          # → dist/plugin.js + manifest.json
npm run package        # → dist/plugin.zip

# Lokal testen (im SP-Monorepo)
npm run install-local  # kopiert nach src/assets/
```

Beide Plugins verwenden die offizielle Plugin-API (`@super-productivity/plugin-api`).

## API-Limits

Die `PluginFieldMapping.taskField` ist auf 6 Werte beschränkt:
`'isDone' | 'title' | 'notes' | 'dueDay' | 'dueWithTime' | 'timeEstimate'`

Das bedeutet: **PRIORITY, CATEGORIES, LOCATION, PERCENT-COMPLETE** können aktuell
nicht via TwoWaySync geschrieben werden. Die Werte werden zwar aus VTODO gelesen
und im `issueDisplay` angezeigt, aber nicht zurückgesynct.

**Lösung:** Die Plugin-API um `taskField: string` erweitern (statt Union-Typ).
Dann alle fehlenden Felder als `FieldMapping` nachrüstbar.
