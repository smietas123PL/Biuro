# 🎭 Scenariusz Demo: "ContentFlow AI" - PRZEWODNIK

Ten system posiada **w pełni zautomatyzowany tryb demonstracyjny**, który można uruchomić jednym kliknięciem. Pokazuje on pełną moc orkiestracji agentów, hierarchii oraz narzędzi (web_search).

---

## 🚀 Jak uruchomić Demo?

1.  Zaloguj się do panelu **Dashboard**.
2.  Przejdź do sekcji **Settings**.
3.  Zlokalizuj sekcję **Demo Scenario**.
4.  Kliknij **"Launch Demo Scenario"**.

### Co się wydarzy po kliknięciu?
*   **Automatyczna Inicjalizacja:** System stworzy nową firmę **"ContentFlow AI (Demo)"**.
*   **Zespół Ekspertów:** Zostanie zaimportowanych 3 wyspecjalizowanych agentów (Strateg, Pisarz, Redaktor) z precyzyjnymi promptami.
*   **Pierwsze Zadanie:** System automatycznie zleci przygotowanie artykułu: *"Impact of AI on Software Engineering in 2026"*.
*   **Real-time Action:** Agenci natychmiast zaczną pracę. Możesz to obserwować w widoku **Digital Twin** oraz **Live Feed**.

---

## 🏗️ Struktura Zespołu

1.  **Strateg Treści (Lead)**
    *   **Zadanie:** Research trendów i planowanie.
    *   **Narzędzia:** `web_search`. Wywołuje wyszukiwarkę, aby zebrać aktualne dane.
    *   **Flow:** Tworzy outline i deleguje pisanie do Autora.

2.  **Autor Techniczny (Pisarz)**
    *   **Zadanie:** Przekształcenie planu w artykuł Markdown.
    *   **Flow:** Przyjmuje wytyczne od Stratega i produkuje treść.

3.  **Starszy Redaktor (QA)**
    *   **Zadanie:** Kontrola jakości i SEO.
    *   **Flow:** Sprawdza artykuł i zamyka zadanie (`complete_task`), co wymaga zatwierdzenia przez właściciela (pokazuje Governance).

---

## 🔍 Co obserwować podczas pokazu?

*   **Pakiety Danych (Live Mesh):** W widoku Digital Twin zobaczysz fioletowe kule "Thoughts" poruszające się między agentami a Systemem Memory.
*   **Hierarchię:** Zauważ, jak Strateg deleguje zadania i jak agenci ze sobą rozmawiają.
*   **Pamięć Synaptyczną:** Każda myśl i research trafia do Knowledge Graph, budując inteligencję firmy "ContentFlow".
*   **Polityki:** Zobaczysz, że ostateczne zakończenie zadania trafi do sekcji **Approvals** – system nie pozwoli agentowi "samowolnie" skończyć bez Twojej zgody.

---

## 🧹 Sprzątanie

Aby zatrzymać demo i usunąć wszystkie dane demonstracyjne, po prostu wróć do **Settings** i kliknij **"Stop & Remove Demo"**. System wyczyści bazę danych z instancji demo.
