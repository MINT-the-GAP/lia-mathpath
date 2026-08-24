<!--
author:   MINT-the-GAP
version:  1.0.0
language: de
mode:     Presentation

import: https://raw.githubusercontent.com/MINT-the-GAP/lia-mathpath/refs/heads/master/README.md
-->

# MathPath Import-Regressionstest

> [!CAUTION]
> @Explain(Tutorial)

# Sichtbares Testbeispiel

Ein *Bruch* besitzt einen *Zähler* und einen *Nenner*. Mehrere *Brüche* verwenden dieselbe
Glossarerklärung für den Begriff Bruch.

Die Division ist hier absichtlich normal und nicht kursiv geschrieben.

<div class="notip">
Hier bleibt <em>Bruch</em> ohne Hervorhebung und Tooltip.
</div>

# Automatische Tooltips ausschalten

```markdown
@tooltip(off)
```

@tooltip(off)

In diesem Import-Beispiel bleibt der automatisch erkannte
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
