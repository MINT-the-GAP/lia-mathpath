# Canvas-Performance: Messung vom 10.09.2026

Die Korrektur beseitigt in diesem Vergleich alle MathPath-Caret-Abfragen über Canvas und alle MathPath-Textdurchläufe über `document.body` während des Schreibens und der geprüften Toolbar-Aktualisierungen. Im zusätzlichen Lauf ohne Stack-/Callbackinstrumentierung wurden beim Schreiben vorher zwölf Long Tasks bis 91 ms gemessen, nachher keine.

## Kurs und unverändertes Layout

Verwendet wurde der vorhandene lokale Kurs `../Fortbildung/Erkunden.md` mit sämtlichen ursprünglichen Imports, Folie **Erweiterte Quizarten**, URL-Fragment `#3`, erste Canvas-Aufgabe (`16428 : 6`). Der genannte Originalkurs mit **Aufgabe 7** ließ sich ohne Kurs-URL nicht eindeutig zuordnen. Diese Messung ist daher eine unabhängige Reproduktion derselben Fehlerursachen auf einem bestehenden Kurs, keine Wiederholung der ursprünglichen 67-ms-Aufzeichnung.

Der gesamte Kurs blieb bytegleich, einschließlich Imports, DynFlex-Anordnung und Aufgaben. Chrome erhielt nur unterschiedliche MathPath-Bundles; README, Glossar und Explain wurden für beide Varianten identisch aus dem lokalen Projekt geliefert. Die kursbestimmenden Bounding-Rects stimmten vollständig überein. Die Screenshots vor dem Schreiben sind ebenfalls bytegleich (SHA-256 `6906c87b8e657d73355f9c5d2c1ca02dc5d41fff23f2bfebb5b9b32ef6be3e89`).

| Gegenstand | SHA-256 |
| --- | --- |
| Kursbytes | `6b2497759d6ed23db56b5f157cf4f7ef5161cd74c4e4bb4b1ecccd5918afd861` |
| Vorher-Bundle, 306619 Bytes | `24c8d9950416b03d1387393c6f2eda791fa19f34c187312d33692f790bf67a0b` |
| Korrigiertes Bundle, 309923 Bytes | `68105dc41c82cb1d684c0ae3cd8958717afc8e5ab1886023bfed29593f690a60` |

Das Vorher-Bundle entspricht exakt `aa920eda4c435a80d1d189d55e86fca50e96670c:dist/index.js`. Es wurde vor dem Neubau gesichert; vorhandene lokale Quelländerungen wurden nicht zurückgesetzt.

## Durchführung

[Das eigenständige CDP-Skript](../scripts/browser-performance.mjs) benötigt Node 24 und Chrome, keine zusätzlichen npm-Abhängigkeiten. Gemessen wurde mit **Chrome 152.0.7977.83**, Windows, 1440 × 1000 Pixeln und **vierfacher CPU-Drosselung**. Vor der Messung wurden zehn Sekunden nach Kursbereitschaft sowie die Initialisierung der geöffneten Canvas abgewartet; die sechs Explain-Startwiederholungen liegen damit außerhalb der Schreibfenster.

Jede Variante erhält drei gleiche Schreibfolgen mit jeweils 120 gesendeten Stiftbewegungen plus der anfänglichen Positionierung. In allen gewerteten Durchläufen kamen **121 Pointermoves auf Canvas** an. `elementFromPoint()` prüft den Start in der freien Zeichenfläche. Der Pixelhash der Canvas verändert sich nach jedem Strich; auch die drei resultierenden Hashes stimmen zwischen Vorher und Nachher überein. Das Skript speichert zusätzlich Screenshots nach dem Schreiben.

Anschließend folgen 30 Aktualisierungsgruppen im Abstand von 40 ms: eine zusätzliche Klasse an einer vorhandenen `bm-row`, eine Button-Klasse und eine Button-ID. Diese Zusatzklassen haben keine CSS-Regeln. Reaktionen der weiterhin aktiven importierten Templates bleiben Teil des Vergleichs.

Es wurden keine Erkennen-/Prüfen-Schaltflächen und keine OCR-Auswahlwerkzeuge betätigt. Verwendet wurde gewöhnliches `@canvas`, kein Canvas-Plus-Modus. Während sämtlicher Schreibfenster gab es **keine Netzwerkanfragen**; OCR-Ladestatus und TFJS-Zustände blieben unverändert/inaktiv. Der lokale Canvas-Code beendet Striche ohne automatische OCR im gewöhnlichen Canvas-Modus. Eine separate Instrumentierung interner OCR-Aufrufe wurde nicht vorgenommen.

## Ergebnisse

Die deterministischen Zähler stammen aus dem instrumentierten Lauf. Ein diagnostischer `sourceURL`-Kommentar ermöglicht die Zuordnung des von LiaScript als Blob geladenen MathPath-Bundles. Gezählt werden MathPath-Text-TreeWalker mit `SHOW_TEXT`-Bit, einschließlich kombinierter `SHOW_ELEMENT | SHOW_TEXT`-Walker. Ein solcher Zähler bezeichnet einen Textdurchlauf über den jeweiligen DOM-Bereich, nicht notwendigerweise einen einzelnen Aufruf der öffentlichen Highlight-Funktion.

| Instrumentierter Lauf | Vorher | Nachher |
| --- | ---: | ---: |
| Canvas-Pointermoves, drei Schreibfolgen | 363 | 363 |
| Caret-Abfragen im MathPath-Handler über Canvas | 363 | 0 |
| Range-Geometrieabfragen im Handler über Canvas | 0 | 0 |
| MathPath-Textdurchläufe über body beim Schreiben | 40 | 0 |
| MathPath-Textdurchläufe über body bei Toolbar-Updates | 140 | 0 |
| Schreib-Long-Tasks, gesamte Seite | 10, maximal 77 ms | 1, 52 ms |
| Toolbar-Long-Tasks, gesamte Seite | 35, maximal 81 ms | 0 |

Eine zweite A/B-Serie wurde mit `--timingOnly true` ausgeführt. Sie lässt die Stack-Prüfungen, TreeWalker-/Caret-Hooks und Callback-Zeitmessungen weg. Aktiv bleiben nur der Long-Task-Observer und ein einfacher Canvas-Pointerzähler. Die Nullen in den deaktivierten Detailzählern dieses Modus sind **keine** zusätzlichen Messbefunde.

| Lauf ohne Stack-/Callbackinstrumentierung | Vorher | Nachher |
| --- | ---: | ---: |
| Schreibfolge 1 | 4 Long Tasks, maximal 80 ms | 0 |
| Schreibfolge 2 | 4 Long Tasks, maximal 91 ms | 0 |
| Schreibfolge 3 | 4 Long Tasks, maximal 82 ms | 0 |
| Gesamtdauer der Schreib-Long-Tasks | 967 ms | 0 ms |
| Toolbar-Updates | 35 Long Tasks, maximal 83 ms | 0 |
| Gesamtdauer der Toolbar-Long-Tasks | 2686 ms | 0 ms |

Die gemessenen Schreib-Long-Tasks entfallen damit in dieser Stichprobe vollständig. Aus den CDP-Gesamtlaufzeiten wird keine Eingabelatenz oder allgemeine Beschleunigungsquote abgeleitet: Sie enthalten Transport, explizite Wartezeiten, Rendering und Browser-Scheduling. Im instrumentierten Lauf bleibt ein einzelner globaler 52-ms-Task; die Korrektur garantiert keine vollständig blockierungsfreie Seite mit beliebigen Imports.

## Funktions- und Regressionstests

Beide A/B-Serien bestanden. Im Browser wurden neue unmarkierte Glossartexte, änderung eines vorhandenen Textknotens, Hover, Schließen beim Wechsel auf Canvas und Erhalt angehefteter Tooltips geprüft. Der erweiterte zweite Lauf prüft zusätzlich die Position eines angehefteten Tooltips nach Resize auf 1100 × 800 gegen dessen konkrete Text-Range: gemessen und erwartet links 370 / oben 48 Pixel, vollständig innerhalb des Viewports. Der Pin schließt beim Folienwechsel; tatsächlicher Kurstext öffnet danach den Bruch-Tooltip auf der nächsten Folie und den Term-Tooltip nach der Rückkehr.

Die Projekttests ergaben **58/58 bestanden**, darunter **44/44 UI-Tests**. Die UI-Suite gegen das alte Bundle ergibt **29/44 bestanden**: 15 neue Regressionen schlagen dort fehl. `npm run test:browser` bestand für README-Demo und Consumer-Import. TypeScript-Prüfung, Syntaxprüfung des Performance-Skripts und `git diff --check` bestanden ebenfalls.

## Reproduktion und Artefakte

Vor einer änderung lässt sich das bestehende Bundle einfach nach `.parcel-cache/browser-performance/baseline-index.js` kopieren. Für den hier geprüften Ausgangsstand funktioniert alternativ folgender byteerhaltender Befehl auch unter Windows PowerShell:

```sh
node -e "const fs=require('node:fs'),cp=require('node:child_process');fs.mkdirSync('.parcel-cache/browser-performance',{recursive:true});fs.writeFileSync('.parcel-cache/browser-performance/baseline-index.js',cp.execFileSync('git',['show','aa920eda4c435a80d1d189d55e86fca50e96670c:dist/index.js'],{maxBuffer:2000000}))"
npm run build
node scripts/browser-performance.mjs --course ../Fortbildung/Erkunden.md --slide 3
node scripts/browser-performance.mjs --course ../Fortbildung/Erkunden.md --slide 3 --timingOnly true --output .parcel-cache/browser-performance/timing-only/comparison.json
```

`--chrome`, `--baseline`, `--fixed`, `--url`, `--course`, `--slide`, `--repeats`, `--moves` und `--output` passen Browser, Kurs und Testdaten an. Bei einem anderen lokalen Kurs muss `--url` die dazugehörige LiaScript-URL angeben; der lokale Kursinhalt wird für diese URL unverändert geliefert. Der Defaultkurs liegt außerhalb dieses Repositorys. Für die exakt geprüften Kursbytes existiert in diesem Arbeitsverzeichnis zusätzlich `.parcel-cache/browser-performance/course.md`.

Lokale, bewusst ignorierte Artefakte:

- [Instrumentiertes JSON](../.parcel-cache/browser-performance/comparison.json)
- [Timing-only JSON](../.parcel-cache/browser-performance/timing-only/comparison.json)
- [Vorher-Layout](../.parcel-cache/browser-performance/baseline.png), [Nachher-Layout](../.parcel-cache/browser-performance/fixed.png)
- [Vorher mit Strichen](../.parcel-cache/browser-performance/baseline-drawn.png), [Nachher mit Strichen](../.parcel-cache/browser-performance/fixed-drawn.png)

## Verbleibende Grenzen

Dies ist ein Headless-Chrome-Vergleich mit CDP-Stifteingaben auf einer Maschine und drei Schreibfolgen je Variante, kein Test physischer Stifthardware und keine Wiedergabe der ursprünglichen Aufgabe 7. Long Tasks messen die ganze Seite einschließlich fremder Templates. Externe Imports werden live geladen und können sich ändern; für langfristig exakt reproduzierbare Laufzeiten müssten auch diese Ressourcen gepinnt werden. Stack-Instrumentierung kann gerade die alte Variante mit mehr Textdurchläufen zusätzlich belasten; deshalb sind die Zeitwerte der zweiten Serie separat ausgewiesen.

Echte Inhaltsänderungen werden lokal pro Frame gebündelt; unveränderte Range-Objekte bleiben erhalten. Registry-Aktualisierung und Bereinigung bleiben dabei linear in der Zahl indizierter Treffer. Im Fallback ohne CSS Highlights werden bei Layoutänderungen weiterhin Rechtecke sämtlicher Treffer ermittelt. Ein ausdrücklicher Glossarwechsel oder eine neu entdeckte Glossartabelle erfordert weiterhin eine globale Neuindizierung.
