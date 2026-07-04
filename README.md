<!--
author:   MINT-the-GAP, Martin Lommatzsch
version:  0.0.1
language: de
edit:     true
comment:  LiaScript plugin for reusable math path components.
script:   ./dist/index.js

-->

# LiaScript MathPath Plugin



Dieses Repository bildet die technische Basis für den schrittweisen Aufbau von `lia-mathpath`.



``` markdown
import: https://github.com/MINT-the-GAP/lia-mathpath/README.md
```


Der Fokus der ersten Ausbaustufe liegt auf einer stabilen Repo-Struktur (TypeScript Quellcode,
Parcel Build nach `dist/index.js`, importierbare LiaScript README).


__Try it on LiaScript:__
https://liascript.github.io/course/?https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/main/README.md



In einem LiaScript Kurs kann das Plugin so eingebunden werden:

`import: https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/main/README.md`


## Aktuelle Basisfunktionen

- Modulstruktur analog zu bestehenden `lia-*` Repos
- Globales API Objekt `window.__LIA_MATHPATH__`
- Glossar-Import aus Markdown-Tabellen (automatisch via Fetch aus `Glossar.md`)
- Hover/Click Interaktion für markierte Begriffe (`data-lia-term`)
- Tooltip-Anzeige fuer Glossarbegriffe mit TeX-Rendering
- Persistenter Store fuer Glossar und Versuchszaehler

## Nächste Schritte (Roadmap)

1. Weitere Verfeinerung der Glossar-Erkennung in dynamischen LiaScript-Inhalten
2. Verbesserte Mobile-Darstellung und Positionierung der Tooltips
3. Feinschliff der Glossar-Highlight-Regeln fuer Sonderfaelle
4. Ausbau von Tests und Validierung fuer die Tooltip-Interaktionen
