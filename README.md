<!--
author:   MINT-the-GAP; Martin Lommatzsch
version:  0.0.16
language: de
edit:     true
comment:  LiaScript plugin for reusable math path components.
script:   ./dist/index.js


@Explain: <lia-mathpath-explain data-lia-explain-topic="@0"></lia-mathpath-explain>

@Lernpfad: <lia-mathpath-lernpfad></lia-mathpath-lernpfad>

@tooltip: <script modify="false">void window.__LIA_MATHPATH__.setTooltips("@'0")</script>

@ADetails
<script modify="false" run-once style="display:inline-block">
const args = ["@'0", "@'1", "@'2", "@'3", "@'4", "@'5", "@'6", "@'7", "@'8", "@'9", "@'10", "@'11", "@'12", "@'13", "@'14", "@'15", "@'16", "@'17", "@'18", "@'19", "@'20", "@'21", "@'22", "@'23", "@'24", "@'25", "@'26", "@'27", "@'28", "@'29", "@'30", "@'31"];
const overflow = "@'32";
const missingArgument = index => "@" + "'" + String(index);
while (args.length && args[args.length - 1] === missingArgument(args.length - 1)) args.pop();
if (overflow !== missingArgument(32)) {
  send.lia("HTML: <span role='alert'>Zu viele Metadatenargumente. Bitte die vollständige Angabe in Backticks setzen.</span>");
} else {
  const marker = document.createElement("lia-adetails");
  marker.className = "lia-assignment-details";
  const instance = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join("-");
  marker.setAttribute("data-adetails-instance", "lia-adetails-" + instance);
  marker.setAttribute("data-adetails", args.join(","));
  send.lia("HTML: " + marker.outerHTML);
}
"LIA: stop"
</script>
@end

-->

# LiaScript MathPath Plugin



Dieses Repository bildet die technische Basis für den schrittweisen Aufbau von `lia-mathpath`.



``` markdown
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/refs/heads/master/README.md
```


Der Fokus der ersten Ausbaustufe liegt auf einer stabilen Repo-Struktur (TypeScript Quellcode,
Parcel Build nach `dist/index.js`, importierbare LiaScript README).


__Try it on LiaScript:__
https://liascript.github.io/course/?https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/master/README.md


**Live-Test: manuell und außerhalb eines Hints**

@Explain(Tutorial)



Für ein manuell gesetztes Explain-Thema muss MathPath direkt im einzigen
LiaScript-Hauptkopf des verwendenden Kurses importiert werden:

```markdown
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/refs/heads/master/README.md
```

Auch das automatische Thema aus `@ADetails` funktioniert mit MathPath allein.
Für Abgabe und eingefrorene Auswertung kann zusätzlich das kompatible
`lia-freeze-v2` ab Version **1.0.1** direkt importiert werden. Auf verschachtelte
Template-Imports sollte man sich nicht verlassen.

```markdown
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-freeze-v2/main/README.md
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/refs/heads/master/README.md
```

Nach dem MathPath-Import stehen `@ADetails`, `@Explain` und `@tooltip` zur Verfügung.
Ein Import eines anderen Templates, das seinerseits MathPath einbindet, reicht
nicht zuverlässig aus. Bleibt `@Explain(...)` als Text sichtbar, fehlt im
verwendenden Kurs fast immer dieser direkte Import.


# Glossarbegriffe sicher verwenden

MathPath ersetzt keine von LiaScript beziehungsweise Elm verwalteten Textknoten. Normale
Glossarbegriffe werden dort als DOM-Ranges erkannt und ohne zusätzliche Wrapper über CSS
Highlights beziehungsweise einen externen Overlay-Fallback markiert. Hover und Klick werden
anhand der Range-Rechtecke erkannt. Vorhandene semantische Elemente bleiben Begriffsträger.

## Kursive Volltreffer

Ein kursiv geschriebener Begriff wie `*Bruch*` wird von Markdown als bestehendes
`<em>`-Element erzeugt. MathPath bindet den Tooltip an dieses Element, wenn dessen gesamter
Text nach dem Trimmen genau einem Glossarbegriff oder einer Aliasform entspricht. Der enthaltene
Textknoten wird dabei nicht ersetzt. Setze Satzzeichen außerhalb der Kursivmarkierung; ein Ausdruck
wie `*ein Bruch*` ist kein Volltreffer.

## Aliasformen in `Glossar.md`

Die optionale dritte Tabellenspalte `Aliasformen` enthält mit Semikolon getrennte, ausdrücklich
erlaubte Wortformen. Alte Glossare mit nur `Begriff` und `Erklärung` bleiben gültig.

```markdown
| Begriff | Erklärung | Aliasformen |
|---|---|---|
| Bruch | Ein Bruch besteht aus einem Zähler und einem Nenner. | Brüche; Brüchen |
| Erweitern | Brüche können durch Erweitern umgeformt werden. | erweitert |
```

Begriff und Aliasformen werden als vollständige Wörter abgeglichen. Kleingeschriebene
Verb- und Adjektivformen ignorieren dabei die Groß-/Kleinschreibung, damit sie auch am Satzanfang
funktionieren. Eine großgeschriebene Aliasform kennzeichnet dagegen eine substantivische Form und
wird im automatisch gescannten Text nur mit großem Anfang markiert. So verweist `Zahlen` auf
`Zahl`, während das Verb in `wir zahlen` unmarkiert bleibt. Es findet kein allgemeines Stemming
statt. Ein exakter Glossarbegriff hat Vorrang vor einer Aliasform; bei überlappenden Treffern wird
die längere, genauere Form verwendet.


# Makro `@Explain`

Das Makro `@Explain` erzeugt Links zu passenden Erklärungskursen. Ein manuell
gesetztes Thema wie `@Explain(Tutorial)` kann an beliebiger Stelle im Kurs stehen.
Beim parameterlosen Aufruf wird das Thema wie bisher aus `@ADetails(...)` gelesen.
Die Themen werden mit den Links aus `Explain.md` verknüpft.

**Zweck**

- Zeigt Erklärungs-Links passend zur aktuellen Aufgabe
- Kann mit einem manuell gesetzten Thema frei im Kurs platziert werden
- Kann parameterlos als kontextbezogener Hinweis einer Aufgabe verwendet werden
- Öffnet Erklärungen im Overlay (90% Fensterbreite und 90% Fensterhöhe)

**Voraussetzungen**

1. Das manuelle Thema muss der Schreibweise in der ersten Spalte von `Explain.md`
   entsprechen; Groß-/Kleinschreibung und Akzente werden beim Abgleich normalisiert.
2. `@Explain(Thema)` benötigt weder ein Quiz noch einen Hint oder `@ADetails`.
3. Nur für den automatischen Aufruf `@Explain` muss `@ADetails` vorhanden sein.
   Mehrere Themen in `@ADetails` werden mit Komma getrennt.

**Manuell ohne Freeze und außerhalb eines Hints**

```markdown
Dieser Erklärungskurs kann frei im Kurs verlinkt werden:

@Explain(Tutorial)
```

Der zugehörige Live-Test steht auf der Startfolie dieses Kurses.


**Automatisch mit `@ADetails`**

```markdown
<!-- data-hint-button="1" -->
Bruchrechnung: [[  Test  ]]
[[?]] @Explain

@ADetails(1=BE; Bruchrechnung, Einheiten)
```

<!-- data-hint-button="1" -->
Bruchrechnung: [[  Test  ]]
[[?]] @Explain

@ADetails(1=BE; Bruchrechnung, Einheiten)


**Verhalten zur Laufzeit**

1. Vor dem ersten Prüfen ist kein nativer Hint-Button sichtbar (bei `data-hint-button="1"`).
2. Nach dem ersten Prüfen erscheint der native Hint-Button.
3. Nach Klick auf den Hint-Button werden die Explain-Hinweise eingeblendet.
4. Klick auf einen Explain-Link öffnet die Zielseite im Overlay statt in einem neuen Tab.
5. Ein explizites Thema aus `@Explain(Thema)` hat Vorrang vor einem vorhandenen
   `@ADetails`-Kontext.
6. Ist für keines der ermittelten Themen ein Erklärungskurs verlinkt, erscheint stattdessen
   der Hinweis „Leider gibt es noch keinen automatisch verlinkten Erklärungskurs.“
7. Die Links und der Hinweis werden im Shadow DOM von `lia-mathpath-explain` gerendert; die native
   Hint-Struktur bleibt vollständig unter LiaScripts Kontrolle.


# Makro `@ADetails` ohne Freeze

Ab MathPath **0.0.10** genügt dieser direkte Import im Kurskopf:

```markdown
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/master/README.md
```

`@ADetails` steht mit einer Leerzeile nach dem zugehörigen Quiz. MathPath zeigt
die Punkte neben dem Marker an; `@Explain` liest dessen Themen auch ohne Freeze.
Es werden weder eine Abgabe, eine Kurssperre noch eine neue Ergebniserfassung aktiviert.

```markdown
Das Ergebnis ist [[ 7 ]].
[[?]] @Explain

@ADetails(2=BE;Bruchrechnung, Einheiten)

Ein weiteres Ergebnis ist [[ 8 ]].
[[?]] @Explain

@ADetails(`points=1|2;tags=Einheiten, Bruchrechnung`)

Unbewertete Eingabe: [[___]]

@ADetails(0=BE;Reflexion)
```

Unterstützt werden einfache nichtnegative Punktewerte, `1=BE`, die Schlüssel
`point`, `points`, `be`, `punkt`, `punkte` mit `:` oder `=`, Dezimalpunkt und
Dezimalkomma sowie summierte Teilwerte mit `|`. Der erste gültige Punktewert
gewinnt. `tag`/`tags` mit `:` oder `=` sind optional; doppelte Tags werden entfernt.
`0` wird als `0 BE` angezeigt. Ohne expliziten gültigen Punktewert bleibt der
Marker ohne Plakette; der Freeze-Auswertungsdefault ist davon unabhängig.

Kommas sind gleichzeitig LiaScript-Parametertrenner. Das gemeinsame Makro erhält
bis zu 32 einzelne Argumente einschließlich des Punktearguments. Für umfangreichere
Angaben oder zur eindeutigen Gruppierung die vollständige Spezifikation in Backticks
setzen; innerhalb dieses einen Arguments sind beliebig viele Themen möglich.
Bei mehr als 32 ungruppierten Argumenten erscheint eine Fehlermeldung anstelle
eines unvollständigen Markers. Beispiel mit Dezimalkomma:

```markdown
@ADetails(`points=1,5;tags=Bruchrechnung, Einheiten`)
```

## Gemeinsam mit Freeze

Die vollständige Zusammenarbeit setzt **lia-freeze-v2 ab 1.0.1** mit derselben
gemeinsamen `@ADetails`-Definition voraus. Beide aktualisierten Vorlagen müssen
veröffentlicht beziehungsweise im lokalen Test gemeinsam verwendet werden.

```markdown
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/master/README.md
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-freeze-v2/main/README.md
```

Im Kurs bleibt die Schreibweise unverändert, beispielsweise:

```markdown
Das Ergebnis ist [[ 7 ]].
[[?]] @Explain

@ADetails(`2=BE;Bruchrechnung, Einheiten`)
```

Beide Importreihenfolgen werden unterstützt. LiaScript lädt Vorlagen parallel;
bei gleichnamigen Makros kann die zuerst eingetroffene Definition gewinnen.
Deshalb sind die Definitionen identisch und auf keine MathPath-API angewiesen.
Das Makro serialisiert einen abgetrennten `lia-adetails`-Host mit sicher gesetzten
Attributen in seine eigene Skriptausgabe. Es verschiebt keine nativen Quizknoten.

Ohne Freeze rendert MathPath ausschließlich seine eigene Punkteplakette im Shadow
DOM des Markers. Sobald die Freeze-Laufzeit erkannt wird, entfernt MathPath nur
diesen eigenen Inhalt und überlässt Freeze Anzeige, Bewertung und Zusatzfunktionen.
Das gilt auch bei späterem Laden von Freeze. Die Metadaten bleiben für Explain lesbar.

Älteres `lia-freeze-v2` bis einschließlich 1.0.0 sowie die Variante
`Aufgabensammlung/imports/FreezeREADME.md` mit `Freeze.js` werden als Laufzeit
erkannt; MathPath tritt auch dort zurück. Deren alte Makrodefinition kann jedoch
zusätzliche Kommaargumente abschneiden. Für solche Kurse immer die gesamte
Angabe in Backticks setzen. Der optionale Quellenfallback für Explain ersetzt
keine vollständigen Marker-Metadaten. Das alte `Freeze.js` verändert außerdem
selbst die native Quiz-Buttonzeile; die vollständige DOM-sichere Zusammenarbeit
ist daher erst mit dem oben genannten aktuellen Freeze gewährleistet.

## Prüfungen

`npm test` prüft die Regressionen, `npx tsc --noEmit` die Typen. Der zusätzliche
Browserlauf `npm run test:browser:adetails` verwendet den tatsächlichen LiaScript-
Interpreter mit lokalen Ressourcenüberschreibungen, einen installierten Chrome
und die benachbarten Freeze-/Resetter-Checkouts. Abweichende Pfade lassen sich mit
`MATHPATH_FREEZE_ROOT`, `MATHPATH_RESETTER_ROOT` und `CHROME_PATH` konfigurieren.
Er veröffentlicht keine Änderungen.

Geprüft werden beide Importreihenfolgen, eine tatsächlich erst nach der Anzeige
gestartete Freeze-Laufzeit, Punkte und Tags, Explain, Reset, Folienwechsel,
Abgabelink-Wiederherstellung, manuelle Punktekorrektur und der reguläre Send-Modus.
Ein bestehender Sonderfall bleibt offen: Bei vorher geöffneten Explain-Hinweisen
kann Send nach dem Folienwechsel eine leere Antwort bewerten. Das wurde auch mit
den unveränderten Ausgangsständen von MathPath und Freeze reproduziert. Der
zusätzliche Fehlernachweis ist mit
`npm run test:browser:adetails -- --scenario=freeze-send --send-with-hints`
aufrufbar und schlägt bis zur gesonderten Behebung fehl. Die neue ADetails-
Unterstützung verändert die Send-Erfassung oder Wiederherstellung nicht.


# Makro `@Lernpfad`

Seit **MathPath 0.0.11** zeigt `@Lernpfad` den Button
„Empfehlungen für deinen weiteren Lernpfad erstellen“. Jeder Klick liest den
aktuellen Lernstand und ersetzt die drei Empfehlungen. Pro Angebot gibt es ein
Themen-Dropdown; Niveau und Umfang von jeweils **vier Aufgaben** sind festgelegt.
Ab **MathPath 0.0.12** besitzt jedes Angebot zusätzlich genau den Button
„Kurs mit 4 Aufgaben öffnen“. Er verwendet das aktuell gewählte Thema und das
angezeigte Niveau, öffnet eine normale LiaScript-Kursansicht in einem neuen
Fenster und lässt den Ausgangskurs unverändert. Der LiveEditor wird dabei nicht
geöffnet. Ab **MathPath 0.0.13** verwendet die Lernpfad-Oberfläche die kompakten,
themefähigen Bedienelemente der MINT-the-GAP-Templates; Status, Hinweise und
Fehler bleiben dabei für Tastatur und Screenreader eindeutig zugeordnet.

Startkurs mit MathPath, Freeze und Resetter:

Ein direkt startbarer, streng validierter Beispielkurs mit acht Aufgaben,
`@resetter`, Freeze-Kompatibilität und abschließendem `@Lernpfad` liegt in
[`Example.md`](./Example.md).

Minimales vollständiges Beispiel mit ausschließlich MathPath:

```markdown
<!--
author: MINT-the-GAP; Martin Lommatzsch
version: 1.0.0
language: de
mode: Presentation
lernpfad-level: Einsteiger
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/master/README.md
-->

# Mein Lernpfad

Bearbeite die Aufgaben und erstelle anschließend deine Empfehlungen.

1. Bruchrechnung

Berechne: Ein Halb plus ein Halb ergibt [[ 1 ]].
[[?]] @Explain

@ADetails(`2=BE;Bruchrechnung, Einheiten`)

2. Einheiten

<!-- lernpfad-level: Fortgeschritten -->

Gib an: Ein Meter entspricht [[ 100 ]] Zentimetern.
[[?]] @Explain

@ADetails(1=BE;Einheiten)

3. Dein weiterer Lernpfad

@Lernpfad
```

Für die zusätzliche Auswertung freigegebener Freeze-Zustände und manueller
Korrekturen ist **lia-freeze-v2 ab 1.0.2** erforderlich. Ergänze dessen direkten
Import im selben Kurskopf:

```markdown
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-freeze-v2/main/README.md
```

Beide Importreihenfolgen und verzögerte Initialisierung werden unterstützt.
Für `@ADetails` allein bleibt die bereits dokumentierte Grenze 1.0.1 bestehen.
MathPath lädt Freeze nicht nach und erzeugt weder Abgabelinks noch Sperren.

Platziere `@Lernpfad` bei gemeinsamem Import auf einer eigenen normalen Folie,
getrennt von `@Auswertung`. Freeze ersetzt die Ansicht seiner Auswertungsfolie;
dort zusätzlich platzierte Lernpfad-Bedienelemente sind deshalb nicht zuverlässig
erreichbar. Auf der separaten Lernpfad-Folie bleibt der Button auch beim Öffnen
eines freigegebenen Freeze-Links nutzbar.

## Regeln für die Empfehlungen

| Angebot | Themenreihenfolge | Zielniveau |
| --- | --- | --- |
| Grundlagen wiederholen | Anzahl aktuell falscher, teilweise richtiger und nachweislich unbearbeiteter Aufgaben | Einsteiger |
| Weitere Übungen | Themenhäufigkeit im gesamten Ausgangskurs | Häufigstes ausdrücklich angegebenes Niveau des ausgewählten Themas |
| Vertiefungen | Themenhäufigkeit im gesamten Ausgangskurs | Eine Stufe über dem bisherigen Niveau |

Falsch, teilweise richtig und unbearbeitet zählen jeweils **eins pro Aufgabe und
Thema**. Frühere Fehlversuche werden nicht zusätzlich gezählt. Bei Gleichstand
im Ranking für **Grundlagen wiederholen** entscheidet die Themenhäufigkeit, anschließend die
alphabetische Reihenfolge. Die beiden anderen Angebote verwenden bei gleicher
Häufigkeit ebenfalls die alphabetische Reihenfolge. Doppelte Themen-Tags werden
auch bei unterschiedlicher Großschreibung nur einmal gezählt.

Bei gemischten Niveaus gilt die häufigste vorhandene Angabe; bei Gleichstand die
niedrigere Stufe. Die Begründung nennt, für wie viele Aufgaben ein Niveau bekannt
ist. Ohne belegte Angabe bleibt das Niveau unbekannt. Über **Experte** gibt es
keine weitere Stufe.

`lernpfad-level:` ist eine **neue, optionale Autorenangabe**. Im Kurskopf gilt sie
als Vorgabe für alle Folien. Ein eigener Kommentar auf einer Folie überschreibt
sie für diese Folie; mit der nächsten Überschrift gilt wieder die Kursvorgabe.
Zulässig sind `Einsteiger`, `Fortgeschritten` und `Experte`. Die Punktezahl oder
ein ADetails-Themenname werden nicht als Niveau interpretiert. Der gemeinsame
Generator bewahrt die gewählte Lernpfad-Stufe im erzeugten Markdown. Ältere,
bereits erzeugte Kurse ohne diese Angabe benötigen weiterhin eine ausdrückliche
Ergänzung.

## Gemeinsamer Katalog und Niveaupolitik

MathPath kopiert weder den Aufgabenkatalog noch die Auswahlregeln. Es lädt die
versionierte Browser-Schnittstelle der Aufgabensammlung:

- `assets/course-catalog.js` mit Schema `schullia-course-catalog`, Version 1,
- `assets/course-generator.js` mit Schema `schullia-course-generator`,
  Version 1 beziehungsweise Release 1.0.4,
- `assets/course-source.js` für den gemeinsamen Markdown-Aufbau.

Die `index.html` der Aufgabensammlung und `@Lernpfad` rufen dieselben
Funktionen zum Validieren, Filtern, Auswählen, Laden und Zusammenbauen auf.
MathPath durchsucht weder deren gerendertes DOM noch steuert es deren Oberfläche.
Eine unbekannte Schema-Version wird abgelehnt und kann beim nächsten Klick neu
geladen werden.

| Lernpfad-Niveau | gemeinsames Zielgruppenprofil |
| --- | --- |
| Einsteiger | `einsteiger` |
| Fortgeschritten | `fortgeschrittene` |
| Experte | `experten` |

Das ist ausdrücklich **keine** starre Umbenennung der Schwierigkeitswerte 1 bis
5. Das gemeinsame Profil verteilt die Auswahl über Schwierigkeit,
Vernetzungsgrad und die bestehenden Operatorregeln. Für Schwierigkeit 1–5 gelten
die Gewichte Einsteiger 35/25/15/15/10 Prozent, Fortgeschrittene
10/25/40/15/10 Prozent und Experten 10/20/35/20/15 Prozent. Für den
Vernetzungsgrad gelten 60/30/5/5/0, 10/25/40/15/10 beziehungsweise
10/20/30/20/20 Prozent. Diese Politik liegt nur im gemeinsamen Generator.

Ein Thema stimmt nur als normalisiertes **vollständiges Katalog-Tag** überein.
Teilzeichenfolgen werden nicht verwendet; Umlaute, Leerzeichen, Kommas und
Backticks bleiben als Themeninhalt erhalten. Die Auswahl ist ohne Ersatz und
enthält vier verschiedene Aufgaben. Mit der API-Option `seed` ist sie
reproduzierbar. Sind nur null bis drei passende Aufgaben vorhanden, wird kein
Teilkurs geöffnet; die Meldung nennt die tatsächliche Trefferzahl.

## Erzeugter Kurs und Übergabe

Der gemeinsame Assembler übernimmt die vier Aufgabenquellen und bewahrt deren
Aufgabeninhalt, `@ADetails`, `[[?]] @Explain`, Punkteformate einschließlich
`0 BE`, Autoren-, Lizenz-, Quellen- und direkte Templateangaben. Direkte
Importe werden dedupliziert. Für einen Lernpfad-Kurs wird ein vorhandener
Freeze-Import entfernt, MathPath direkt importiert, die kanonische Angabe
`lernpfad-level: Einsteiger|Fortgeschritten|Experte` ergänzt und eine eigene
Abschlussfolie mit `@Lernpfad` angefügt. MathPath fügt keine Abgabe,
Auswertung, Sperre oder Send-Konfiguration hinzu.

Die Startfolie erhält abhängig vom Angebot einen eigenen Einführungstext für
**Grundlagen wiederholen**, **Weitere Übungen** oder **Vertiefungen**. Danach
folgt der Tutorial-Hinweis aus den Wochenaufgaben mit einem Link zum zentralen
LiaScript-Tutorial. Erst anschließend beginnen die vier ausgewählten Aufgaben.

Geöffnet wird zunächst ein Link der Form
`https://mint-the-gap.github.io/Aufgabensammlung/course.html?v=1.0.4#course=…`.
Der Hash enthält ausschließlich das strukturierte Manifest mit vier öffentlichen
Aufgaben-URLs, Thema, Angebot und Niveau. Der dortige Launcher lädt diese
öffentlichen Quellen, baut denselben Markdown mit `mode: Presentation`, packt
ihn als gzip-Data-URI und wechselt anschließend mit `location.replace` in den
unveränderten offiziellen Viewer unter
`https://liascript.github.io/course/?data:text/plain;charset=utf-8;Content-Encoding=gzip;base64,…`.
Fehlt der vom Launcher mitgelieferte, fest auf `fflate@0.8.2` gesetzte
gzip-Encoder oder überschreitet die vollständige Vieweradresse 6000 Zeichen,
verwendet der Launcher als ausdrücklich getesteten Kompatibilitätsfallback
weiterhin die eigene `parent:schullia-…`-Framequelle.
Dadurch entstehen weder ein LiveEditor-Kurs noch ein Upload oder eine
Übertragung von Lernständen an einen neuen Server. Das Fenster wird direkt im
Benutzerklick reserviert, vom Ursprungskurs getrennt und bei einem Fehler wieder
geschlossen.

## Gelesene Zustände und Grenzen

MathPath liest auf Anforderung die vorhandenen LiaScript-IndexedDB-Tabellen
`quiz` und `survey` für die **exakte Kurs-URL und passende Hauptversion**.
Es gibt keinen neuen Ergebnislogger, keine Port-Manipulation und keine
automatisch ausgelöste Prüfung, Auflösung oder Rücksetzung. Auch Antworten
anderer Folien werden gelesen; `@resetter` wird beim nächsten Klick berücksichtigt.

Eine gespeicherte richtige Prüfung gilt als richtig; eine noch nicht richtig
geprüfte Aufgabe mit Fehlversuch als falsch. Ein ausdrücklich gespeicherter
Datensatz ohne Prüfung und ein fehlender Datensatz der passenden Kursversion
gelten als **unbearbeitet**. Damit werden auch frische oder unbesuchte Aufgaben
wie ursprünglich vorgesehen gemeinsam mit Fehlversuchen als Übungsbedarf
gerankt. Ein vorhandener, aber strukturell unpassender Datensatz bleibt dagegen
nicht auswertbar. Aufgedeckte Lösungen gelten nicht als Nachweis einer eigenen
richtigen Antwort. Die native Eigenschaft `score` wird nicht als
Richtigkeitsquote verwendet.

In Freeze werden nach Freigabe der wiederhergestellte Snapshot und aktuelle
manuelle Korrekturen gelesen. Teilweise richtig ist anhand einer manuellen
Punktzahl zwischen null und der ausdrücklich angegebenen Maximalpunktzahl belegt.
Offene Antworten ohne Bewertung bleiben nicht auswertbar. **0 BE** wird niemals
durch eine Division oder allein durch die Punktzahl als falsch interpretiert;
ein ausdrücklicher nativer Quizstand bleibt auch bei 0 BE verwertbar.

Vor der Send-Freigabe und während der automatischen Bewertung werden keine
Richtig-/Falsch-Ergebnisse oder Angaben zu Lernlücken ausgegeben. Themen und ausdrücklich
angegebene Niveaus dürfen bereits angezeigt werden. Bei älteren Freeze-Versionen
ohne passende lesende Schnittstelle bleibt der gewöhnliche, nicht eingefrorene
Kurs über den nativen LiaScript-Lernstand auswertbar. Ein eingefrorener oder im
Send-Modus geschützter Zustand bleibt ohne passenden Freeze-Snapshot dagegen
bewusst nicht auswertbar. Der oben dokumentierte Send-Sonderfall mit geöffneten
Explain-Hinweisen bleibt bestehen; der Lernpfad repariert oder verändert keine
Freeze-Bewertung.

Voraussetzung ist eine erreichbare Markdown-Kursquelle mit Kursversion. Neben
HTTP(S)-Markdown und der älteren exakten `parent:schullia-…`-Quelle unterstützt
MathPath die vom offiziellen LiaScript-Viewer verwendete, gzip-komprimierte
`data:text/plain;charset=utf-8;Content-Encoding=gzip;base64,…`-Kursquelle.
Akzeptiert wird nur die kanonische, mit `fflate@0.8.2` und dem festgelegten
Optionssatz erzeugte Base64-/gzip-Darstellung; dadurch bleibt dieselbe Quelle
auch dieselbe LiaScript-/IndexedDB-Identität. Andere Data-URI-Typen,
nichtkanonische oder ungültige Kodierungen, zusätzliche gzip-Daten sowie
übergroße komprimierte oder entpackte Quellen werden abgelehnt. Aufgaben
werden aus dem gesamten verfassten Kurs gelesen, Codebeispiele und der Kurskopf
ausgeschlossen. Bei unbekannten Makroexpansionen oder dynamisch erzeugten Quizzen
bleibt die Zustandszuordnung der betroffenen Folie ausdrücklich unsicher.
Vorhandene Themen bleiben im Themenangebot erhalten; es werden keine geratenen
Aufgabenindizes oder Fehlermeldungen als falsche Antworten gewertet.

## API und Prüfung

`window.__LIA_MATHPATH__.getLearningRecommendations()` liest neu und liefert ein
Promise mit dem strukturierten Bericht. `getLastLearningRecommendations()` gibt
eine Kopie des letzten Berichts für den aktuellen Kurs zurück. Ein gerenderter
`lia-mathpath-lernpfad`-Host bietet über seinen Getter `report` eine Kopie
einschließlich seiner aktuellen Dropdown-Auswahl. Empfehlungen enthalten
`type`, `topic`, `targetLevel`, `taskCount: 4`, `available` und `reason`.
`available` bedeutet, dass Thema und Zielniveau ableitbar sind; es ist noch
keine Zusage über vier verfügbare Aufgaben in der Aufgabensammlung.

`generateLearningCourse({ courseUrl, recommendation }, { seed, signal })`
prüft die Empfehlung vor und nach dem Laden erneut und erzeugt den Kurs, ohne
ein Fenster zu öffnen. Das Ergebnis ist eine Kopie mit `sourceCourseUrl`,
`type`, `topic`, `targetLevel`, `taskCount`, `taskIds`, `markdown`,
`openingTarget` und `catalogVersion`.
`openGeneratedLearningCourse(result)` öffnet ein bereits erzeugtes Ergebnis,
ohne erneut auszuwählen. `openLearningCourse(request, options)` ist die
Komfortfunktion für einen direkten Benutzerklick: Sie reserviert zuerst das
Fenster und erzeugt danach den Kurs. Ein Kurswechsel, eine inzwischen gesperrte
Send-Phase oder eine geänderte Empfehlung beendet den Vorgang ohne Teilkurs.

`npm test` enthält Parser-, Zustands-, Empfehlungs- und DOM-Regressionen.
`npm run test:browser:lernpfad` prüft den tatsächlichen LiaScript-Interpreter mit
lokalen Ressourcenüberschreibungen und denselben Pfadoptionen wie der
ADetails-Browserlauf. `npm run test:browser:adetails` und `npm run test:browser`
prüfen zusätzlich die vorhandenen ADetails-, Explain- und Glossarfunktionen.
`npm run test:browser:lernpfad-generation` prüft den Themenwechsel, das
synchron reservierte Popup, die normale Vier-Aufgaben-Kursansicht sowie
`@ADetails`, `@Explain` und den erneuten `@Lernpfad` im erzeugten Kurs.
Browserläufe benötigen Chrome, Netzwerkzugriff auf den Interpreter sowie die
kompatiblen benachbarten Freeze- und Resetter-Checkouts.

Beim Browsernachweis wurden die wieder geöffneten Freeze-Empfehlungen über die
Oberfläche geprüft. Manuelle Korrekturen wurden ohne Send ebenfalls über den
Button auf einer anderen Folie nachgewiesen. Nach einer manuellen **Send**-
Korrektur erfolgte der Nachweis über `getLearningRecommendations()`, weil die
Freeze-Auswertungsüberlagerung beim Rückweg den Button blockierte. Eine vollständig
bedienbare Oberfläche nach genau diesem Send-Navigationsablauf ist damit noch
nicht nachgewiesen; die Übernahme der korrigierten Punktzahl ist nachgewiesen.

# Bereich ohne Tooltips (`notip`)

Mit einem Container `<div class="notip"> ... </div>` kannst du einen Bereich markieren,
in dem **keine Glossar-Highlights und keine Tooltips** angezeigt werden.

Das ist nützlich für sensible Lösungsbereiche, Antwortfelder oder Texte, die bewusst
ohne Hilfen dargestellt werden sollen. Das gilt auch für kursive Volltreffer und
manuelle `[data-lia-term]`-Elemente.

Das Inhaltsverzeichnis (TOC) bleibt grundsätzlich ohne Glossar-Highlights und
MathPath-Tooltips. Das gilt auch mit `lia-navigation`, nach dem Neuaufbau des TOC
und nach `@tooltip(on)`, einschließlich manuell markierter Begriffe im TOC.

## Sichtbares Testbeispiel

Ein *Bruch* besitzt einen *Zähler* und einen *Nenner*. Mehrere *Brüche* verwenden dieselbe
Glossarerklärung für den Begriff Bruch.

Die Division ist hier absichtlich normal und nicht kursiv geschrieben.

<div class="notip">
Hier bleibt <em>Bruch</em> ohne Hervorhebung und Tooltip.
</div>

**Quelltext des `notip`-Bereichs**

```markdown
<div class="notip">
Hier bleibt <em>Bruch</em> ohne Hervorhebung und Tooltip.
</div>
```


# Automatische Tooltips ausschalten

Mit `@tooltip(off)` werden alle automatisch erkannten Glossarbegriffe ab dieser
Kursposition weder hervorgehoben noch als Tooltip geöffnet. Bereits erkannte
Begriffe werden sofort deaktiviert, und später gerenderte Inhalte bleiben ebenfalls
ohne automatische Tooltips. Manuell gesetzte Elemente mit `data-lia-term` sowie
`@Explain` funktionieren weiterhin.

```markdown
@tooltip(off)
```

Das Makro wird beim Rendern einer Folie erneut ausgewertet. Der Zustand bleibt
erhalten, bis `@tooltip(on)` ausgeführt wird.

@tooltip(off)

In diesem Live-Beispiel bleibt der automatisch erkannte
<em data-tooltip-probe="automatic">Bruch</em> ohne Tooltip. Der
<span data-tooltip-probe="manual" data-lia-term="Bruch">manuell gesetzte Begriff</span>
bleibt dagegen aktiv.


# Automatische Tooltips wieder einschalten

```markdown
@tooltip(on)
```

@tooltip(on)

Hier ist der automatisch erkannte
<em data-tooltip-probe="automatic">Bruch</em> wieder aktiv.
