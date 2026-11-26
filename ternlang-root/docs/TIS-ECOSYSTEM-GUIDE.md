# Ternary Intelligence Stack Ecosystem Guide

## 1. Einleitung

Der Ternary Intelligence Stack (TIS) ist ein integriertes Ökosystem aus Rust-Crates, das darauf ausgelegt ist, ternäre Logik, neuronale Inferenz und autonome Agentenfunktionen in einem einzigen, binär kompatiblen Rahmen zu vereinen. Als Version v1.3.7 ist der Stack am 11. Mai 2026 synchronisiert worden, wobei alle Kernkomponenten dieselbe Versionsnummer tragen. Dieses Dokument dient als umfassende Referenz für Entwickler, Architekten und Wartungsingenieure, die mit dem TIS arbeiten oder erweitern.

## 2. Architekturuebersicht

Der TIS folgt einer schichtichen Architektur mit klaren Trennungslinien zwischen Compiler-Infrastruktur, Laufzeitumgebung, Hardware-Bridge und Agenten-Framework. Die `ternlang-*` Krate bilden die Grundlage: Der Compiler (`ternlang-core`), die Entwicklungswerkzeuge (`ternlang-cli`, `ternlang-lsp`), die Ausfuehrungsumgebung (`ternlang-runtime`) und die Hardware-Synthese (`ternlang-hdl`). Auf dieser Basis baut das `moe-*` Modul ein Modulaeres Experten-System mit MoE-13-Routing auf. Der `albert-*` Layer kapselt den autonomen Agentenkernel `albert-runtime`, der alle diese Komponenten koordiniert. Querschnittsfunktionen wie Ruvector-Persistence (`ternlang-ruvector`), MCP-Protokoll (`ternlang-mcp`), Codegenerierung (`ternlang-codegen`) und Sicherheitsaudit (`termaudit-guard`) verbinden die Schichten miteinander.

## 3. Krateintraege

### 3.1 ternlang-core

`ternlang-core` ist die fundamentalale Compilerebene des Ternary Language Stack. Sie enthaelt die AST-Definitionen, den Lexer, den Parser und die semantische Analyse-Engine. Alle anderen `ternlang-*` und `albert-*` Krate haengen von dieser Basis ab. Die Engine implementiert ternaere Logikoperatoren (`trit`-basiert) sowie die Balance-Ternary-Arithmetic (BETA)-Operationen. Ohne `ternlang-core` laeuft keine andere Komponente des Stacks.

### 3.2 ternlang-cli

`ternlang-cli` ist der zentrale Orchestrierungstreiber fuer VM-Ausfuehrung, Build-Pipelines und Debugging. Es stellt den Befehlszeileninterface fuer die Interaktion mit dem TIS bereit. Entwickler nutzen es fuer das Kompilieren von Ternlang-Quellcode, das Ausfuehren von Test-Suites und das Debuggen von Laufzeitfehlern in der verteilten Actor-Umgebung. Es ist eng mit `ternlang-core` und `ternlang-runtime` verknuepft.

### 3.3 ternlang-api

`ternlang-api` implementiert eine High-Performance-Schnittstelle fuer agentische Reasoning-Dienste. Sie expose JSON-RPC- und REST-Endpunkte, die von externen Clients aufgerufen werden koennen. Der Dienst ist fuer niedrige Latenz und hohe Durchsatz optimiert, was fuer die Koordination von MoE-13-Experten und die Abstimmung mit `albert-runtime` erforderlich ist. Alle API-Aufrufe werden als asynchrone Nachrichten an `ternlang-runtime` weitergeleitet.

### 3.4 ternlang-runtime

`ternlang-runtime` stellt die verteilte Actor-Modellierung, TCP-Transportierung und VM-Ausfuehungsumgebung bereit. Es ist die Laufzeit, in der alle ternaeeren Berechnungen stattfinden. Die Runtime implementiert einen verteilten Aktorplaner, der Nachrichten zwischen `albert-*` Agenten, `moe-*` Modulen und Hardware-Backends (`ternlang-hdl`) routet. TCP-Transportierung ermoeglicht die Netzwerk-Transparenz ueber mehrere Knoten hinweg.

### 3.5 ternlang-lsp

`ternlang-lsp` ist ein Language Server Protocol 3.17 Server fuer VS Code-Diagnostik und Toolunterstuetzung. Er implementiert Autovervollstaendigung, Syntax-Highlighting, Fehlerdiagnosen und Refactoring-Vorschlaege fuer die Ternlang-Sprache. Der LSP-Server kommuniziert mit dem Compiler in `ternlang-core` und kann in Echtzeit semantische Analysen durchfuehren, was fuer IDE-Integrationen von hoher Bedeutung ist.

### 3.6 ternlang-compat

`ternlang-compat` ist die plattformuebergreifende Abstraktions- und Rueckwaerts-Kompatibilitatsschicht. Sie kapselt Betriebssystem-spezifische APIs (Dateisystem, Netzwerk, Prozessmanagement) hinter einer einheitlichen Schnittstelle. Diese Schicht stellt sicher, dass der TIS auf Linux, macOS und Windows lauffähig ist, ohne dass Plattform-spezifische Anpassungen in den Kernkrusten erforderlich sind. Alle anderen Krate nutzen diese Abstraktion durch Dependency Injection.

### 3.7 ternlang-mcp

`ternlang-mcp` implementiert das Machine Communication Protocol fuer sichere, verschluesselte Kommunikation zwischen TIS-Komponenten. Es stellt sicher, dass alle Nachrichten zwischen verteilten Aktoren, MoE-Experten und externen Agenten (wie `albert-cli`) Authentifizierung, Integritaet und vertraulicheUEbertragung gewaehrleisten. Das Protokoll ist in `ternlang-runtime` integriert und wird automatisch fuer alle TCP-Verbindungen verwendet.

### 3.8 ternlang-ruvector

`ternlang-ruvector` implementiert einen persistierbaren, ternaeren Vektorspeicher fuer Langzeitgedächtnis und Shared-Memory zwischen Agenten. Es basiert auf RuVector, einem ternaeren Attention-Memory-Modell, das durch `albert-runtime` verwaltet wird. Der Speicher ist crash-sicher (WAL-basiert), unterstuetzt verteilte Replikation und ermoeglicht das Abrufen von Erinnerungen über eine Vektore-Ähnlichkeitssuche. Alle Agenten im TIS nutzen diesen Speicher als gemeinsame Wissensbasis.

### 3.9 ternlang-codegen

`ternlang-codegen` ist verantwortlich fuer die Niedrigsprachen-Codegenerierung aus dem Ternlang-AST. Sie kann Zielcode fuer x86-64, ARM und spezielle ternäre Hardwaregeneratoren erzeugen. Die Codegenerierung nutzt `ternlang-hdl` als Bridge zu Verilog-Ausgabe für FPGA-Synthese. Ohne diese Komponente kann der Compiler zwar analysieren, aber keine ausfuehrbare Binärdatei erzeugen.

### 3.10 ternlang-hdl

`ternlang-hdl` implementiert einen Verilog/HDL-Backend und eine Synthese-Pipeline für ternäre Hardwareprimitive. Es übersetzt ternäre Logikstrukturen aus dem AST in HDL-Code, der auf FPGAs synthetisiert werden kann. Diese Komponente ist die Brücke zwischen der softwarebasierten Logik und der physischen Hardwareimplementierung des ternären Prozessors. Sie ist eng mit `ternlang-codegen` gekoppelt.

### 3.11 ternlang-moe

`ternlang-moe` implementiert die sparse-tägigen Inferenzkerne, QAT-Trainer und neuronalen Reasoning-Primitive für das MoE-13-Modell. Es kapselt Experten-Gating, Sparse-Matrix-Vektor-Multiplikation und Load-Balancing-Algorithmen in ternärer Darstellung. Diese Komponente ist die Kernkomponente für das Training und die Inferenz von MoE-13-basierten Transformation Modellen. Sie wird von `albert-runtime` als Reasoning-Engine genutzt.

### 3.12 ternlang-compress

`ternlang-compress` implementiert verlustfreie und verlustbehaftete Komprimierung für ternäre Datenstrukturen, Aktoren-Nachrichten und Modellgewichte. Es unterstützt sparse-tägige Quantisierung, Trit-Kompression und Balanced-Ternary-Packing nach dem BET-Format. Alle persistierten Daten (Erinnerungen, Trainingsgewichte, Logdateien) durchlaufen diese Komponente vor der Speicherung oder Übertragung.

### 3.13 ternlang-test

`ternlang-test` ist das integrierte Test-Framework für TIS-Komponenten. Es stellt Unit-Test-Runner, Integrationstest-Harness und Fuzz-Testing für ternäre Logikfunktionen bereit. Das Framework ist in `ternlang-cli` eingebettet und generiert automatisch Code-Coverage-Berichte in Trit-Sichtbarkeit. Alle Pull-Requests müssen mit `ternlang-test` grün durchlaufen, bevor sie gemerged werden können.

### 3.14 ternpkg

`ternpkg` ist der Paketmanager für den TIS-Ökosystem. Er verwaltet Abhängigkeiten zwischen Korten, Version-Pinning, Registry-Spiegelung und sichere Installation von Drittanbieter-Extensions. Der Paketmanager ist analog zu Cargo für Rust, aber erweitert um ternäre Versionierungssemantik und MoE-13-Modell-Paket-Unterstützung. Alle Krate im TIS-Register werden über `ternpkg` installiert und aktualisiert.

### 3.15 albert-runtime

`albert-runtime` ist die neuronale Referenzarchitektur (Lower-Level Brain) für ternäre Transformation Modelle. Als Soveräner Agentenkernel koordiniert er alle TIS-Komponenten: Er dispatcht Nachrichten über `ternlang-runtime`, ruft Inferenzkerne in `ternlang-moe` auf, persistiert Erinnerungen über `ternlang-ruvector` und leitet Codegenerierung über `ternlang-codegen` ein. Albert ist der autonome Kern, der Reasoning, Planung und Ausführung in einer Schleife verbindet.

### 3.16 albert-cli

`albert-cli` ist die Befehlszeilenschnittstelle für den albert-runtime Agentenkernel. Sie ermöglicht es dem Benutzer, Agenten zu starten, zu stoppen, ihre Erinnerung zu inspizieren und Befehle direkt an die Reasoning-Engine zu senden. Die CLI ist eng mit `ternlang-cli` verknüpft und teilt ein gemeinsames Konfigurationsschema. Alle Interaktionen mit dem Agenten laufen über diese Komponente.

### 3.17 albert-api

`albert-api` implementiert eine Secure-by-Default HTTP/gRPC-Schnittstelle für den albert-runtime Agenten. Externe Systeme können über diese API Agenten-Status, Task-Dispatch und Ergebnisabruf automatisieren. Die API implementiert JWT-Authentifizierung, Rate-Limiting und Audit-Logging. Alle produktiven Deployment-Szenarien nutzen diese Komponente für die Service-Integration.

### 3.18 albert-commands

`albert-commands` ist die interne Befehls-Dispatch-Schicht für TUI/CLI-Interaktionen mit albert-runtime. Sie kartiert Benutzereingaben in Ternlang-Befehle und leitet sie an den Agentenkernel weiter. Diese Komponente implementiert Tab-Vervollständigung, Befehls-Historie und Kontextsensitive Help-Texte. Sie ist die Brücke zwischen der menschlichen Interaktion und der maschinischen Reasoning-Engine.

### 3.19 albert-tools

`albert-tools` ist eine Sammlung von Wartungs- und Diagnose-Dienstprogrammen für albert-runtime. Es enthält Utilities für Speicherdump-Analyse, Performance-Profilierung, Agenten-Klonen und Disaster Recovery. Diese Tools werden von Systemadministratoren eingesetzt, um den Agentencluster in Produktion zu überwachen und zu wartent.

### 3.20 albert-compat

`albert-compat` ist die Kompatibilitnungsschicht für den Übergang von älteren albert-Architekturen zu v1.3.7. Sie stellt Adapter für veraltete APIs, Konfigurationsformate und Datenbank-Schemata bereit. Neue Deployment-Szenarien sollten diese Komponente nicht direkt verwenden, da sie schrittweise verworfen wird.

### 3.21 moe-core

`moe-core` ist die zentrale Orchestrationsschicht für das Modulares Experten-System (MoE-13). Es implementiert Router, Load-Balancing, Expert-Selektion und Sparse-Activation-Planung in ternärer Darstellung. Diese Komponente ist die Verbindung zwischen dem MoE-13-Modell und dem ternären Rechenkernel in `ternlang-runtime`. Alle Experten-Nachrichten durchlaufen `moe-core` für die Routing-Entscheidung.

### 3.22 moe-platform

`moe-platform` stellt die Plattform-Abstraktionsschicht für MoE-13-Bereitstellungen bereit. Sie kapselt GPU/CUDA, TPU und spezielle ternäre Hardware-Backends hinter einer einheitlichen Schnittstelle. Die Plattform ist in `ternlang-runtime` integriert und ermöglicht die transparente Ausführung von Sparse-Matrix-Operationen auf verschiedener Hardware.

### 3.23 moe-plugin-sdk

`moe-plugin-sdk` ist das Entwicklungs-SDK für benutzerdefinierte MoE-13-Experten und Plugins. Entwickler erhalten Makros, Traits und Templates für die Implementierung neuer Expertenfunktionen in Ternlang. Plugins werden zur Laufzeit über den Plugin-Loader in `moe-runtime` dynamisch geladen. Dieses SDK ist die offene Erweiterungsschnittstelle für das MoE-Ökosystem.

### 3.24 moe-runtime

`moe-runtime` ist die Laufzeitumgebung für MoE-13-Modellausführung und Plugin-Management. Es initialisiert Experten-Kerne, verwaltet deren Speicher und koordiniert die Kommunikation mit `ternlang-runtime` für die Actor-basierte Nachrichtenübertragung. Alle MoE-spezifischen Assoziationen und Expert-to-Expert-Nachrichten werden hier verwaltet.

### 3.25 moe-ddel

`moe-ddel` implementiert Differentielles Data-Embedding-Leveling für MoE-13-Modell-Training. Es stellt sicher, dass Experten-Gewichte während des QAT (Quantization-Aware Training) in einem ternären Gleichgewicht gehalten werden. Diese Komponente ist ausschließlich im Training relevant und nicht im Inferenzpfad aktiv.

### 3.26 moe-sdk

`moe-sdk` ist das umfassende Development-Kit für MoE-13-basierte Anwendungen. Es enthält Build-Templates, Test-Fixtures, Deployment-Scripts und Benchmark-Suites. Entwickler nutzen dieses SDK, um MoE-13-Modelle von der Entwicklung über das Training bis zur Produktionsbereitstellung zu steuern. Es ist die empfohlene Einstiegskomponente für alle MoE-13-Projekte.

### 3.27 moe-uril

`moe-uril` implementiert Unified Reasoning über Inferenz-Level für MoE-13-Aktivierung. Es stellt sicher, dass mehrere MoE-Experten synthetisierte Antworten in einer ternären Konsens-Schicht zusammenführen, bevor das Ergebnis an `albert-runtime` zurückgegeben wird. Diese Komponente ist kritisch für die Konsistenz von multi-expertellen Reasoning-Ketten.

### 3.28 moe-compute

`moe-compute` enthält spezialisierte MoE-Kerne, Matrix-Packing-Algorithmen und vektorisierte ternäre Operationen. Es nutzt SIMD- und GPU-Beschleunigung für maximale Durchsatzleistung bei Sparse-Matrix-Vektor-Multiplikationen. Alle rechenintensiven MoE-Operationen werden über diese Komponente abgewickelt, was für eine Latenzoptimierung entscheidend ist.

### 3.29 moe-test

`moe-test` ist das dedizierte Test-Framework für MoE-13-Komponenten. Es stellt spezifische Assertionen für Experten-Routing, Load-Balancing-Gleichgewicht und ternäre Gewichtsquantisierung bereit. Alle MoE-13-Pull-Requests müssen mit `moe-test` grün durchlaufen, bevor sie in `moe-core` gemergt werden können.

### 3.30 moe-validation-suite

`moe-validation-suite` stellt eine umfassende Test- und Validierungssammlung für MoE-13-Modelle bereit. Sie enthält Benchmark-Datensätze, Korrektheitsprüfungen, Adversarial-Tests und Performance-Messungen für verschiedene Hardware-Konfigurationen. Diese Suite ist die letzte Validierung vor jedem Release des MoE-13-Stacks.

### 3.31 moe-llm-core

`moe-llm-core` ist die Kernkomponente für MoE-13-basierte große Sprachmodelle. Es implementiert Transformer-Architektur-Primitives, Layer-Normalization in ternärer Darstellung und token-basiertes Experten-Routing. Diese Komponente ist die Brücke zwischen dem MoE-13-Framework und der eigentlichen Sprachmodellierung.

### 3.32 pytern

`pytern` ist die Python-Bindings-Schicht für den TIS. Sie ermöglicht es Entwicklern, ternäre Operationen, MoE-13-Modelle und albert-runtime Agenten direkt aus Python-Skripten aufzurufen. Die Bindings nutzen PyO3 und stellen eine asynchrone API für Jupyter-Notebooks und Data-Science-Workflows bereit. Alle Machine-Learning-Experimente mit dem TIS-Ökosystem starten typischerweise über `pytern`.

### 3.33 ternaudit-guard

`termaudit-guard` ist das Sicherheits- und Compliance-Überwachungssystem für den TIS. Es führt statische Code-Analysen durch, überwacht Laufzeitverhalten für unautorisierte Zugriffe und validiert alle externen API-Aufrufe gegen eine Signatur-Datenbank. Diese Komponente ist die letzte Verteidigungsschicht und wird automatisch in allen Produktions-Deployments aktiviert.

## 4. Versionsmanagement

Alle Krate im TIS-Ökosystem folgen dem Semantischen Versionierungsschema in der Form `vMAJOR.MINOR.PATCH`. Die aktuelle Version v1.3.7 wurde am 11. Mai 2026 synchronisiert, was bedeutet, dass alle Krate identische Major-, Minor- und Patch-Versionsnummern tragen. Diese Synchronisation ist zwingend erforderlich, da das TIS-Ökosystem binäre Abhängigkeiten zwischen Korten aufweist, die bei Versionsunterschieden zu Laufzeit-Fehlern führen können. Die Versionskoordination erfolgt über `ternpkg` als zentralen Versions-Manager.

## 5. Build- und Synchronisierungsprozess

Der Build-Prozess läuft über `ternlang-cli` als Orchestrierungstreiber. Zuerst wird `ternlang-core` kompiliert, da alle anderen Krate von ihm abhängen. Anschließend werden die Laufzeitkomponenten (`ternlang-runtime`, `moe-core`, `albert-runtime`) gebaut und miteinander verlinkt. Der Synchronisierungs-Timestamp v1.3.7 wird von der CI-Pipeline in `ternpkg` als Registry-Referenz gesetzt. Jeder Build erzeugt Binärartefakte, die durch `ternlang-compress` komprimiert und in der Versions-Datenbank registriert werden.

## 6. Zusammenarbeit und Abhaengigkeiten

Das TIS-Ökosystem implementiert ein striktes Dependency-Injektionsmodell. `ternlang-core` ist die Baustein-Komponente, von der `ternlang-runtime`, `ternlang-cli` und `ternlang-lsp` abhängen. Auf der Runtime-Schicht bauen `albert-runtime` (Agentenkernel), `moe-core` (Expertenmodell) und `pytern` (Python-Bindings) auf. Querschnittsfunktionen wie `ternlang-mcp` (Kommunikation), `ternlang-ruvector` (Speicher) und `termaudit-guard` (Sicherheit) werden von allen Schichten genutzt. Eine Änderung in `ternlang-core` erfordert daher eine Neubuilds-Kette über alle abhängigen Krate.

## 7. Anhang

Dieses Dokument basiert auf der Version v1.3.7 des TIS-Ökosystem-Registers, synchronisiert am 11. Mai 2026. Änderungen an der Krate-Liste, neue Versionen oder Archivierte Komponenten werden in `ECOSYSTEM.md` (dieses Verzeichnis) gepflegt. Für Beiträge zum TIS-Ökosystem nutzen Sie `ternpkg` zur Registrierung neuer Krate und stellen Sie ein Pull-Request gegen dieses Dokument. Alle Krate in diesem Register unterliegen der Apache-2.0-Lizenz mit ternärer Erweiterungs-Klausel.
