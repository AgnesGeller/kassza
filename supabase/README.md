# Supabase beállítás

1. Hozz létre egy ingyenes Supabase projektet.
2. A **SQL Editorban** futtasd le a `schema.sql` teljes tartalmát.
3. Az **Authentication / Users** oldalon hozz létre 6 felhasználót ezekkel az e-mail-címekkel, és adj nekik legalább 6 karakteres PIN-t jelszóként:
   - `adam@kassza.diszkertek.hu`
   - `agi@kassza.diszkertek.hu`
   - `bendeguz@kassza.diszkertek.hu`
   - `mark@kassza.diszkertek.hu`
   - `tamas@kassza.diszkertek.hu`
   - `zsolti@kassza.diszkertek.hu`
4. Másold ki a hat felhasználó UUID-jét, majd futtasd le a `profiles-template.sql` tartalmát.
5. A Project URL-t és a publishable/anon kulcsot írd a `supabase-config.js` fájlba. A `service_role` kulcsot soha ne tedd az alkalmazásba vagy GitHubra.
6. Authentication / URL Configuration alatt add meg a webapp címét: `https://agnesgeller.github.io/kassza/`.
7. A célzott kasszaértesítésekhez futtasd le a `cash-protected-date-alerts.sql`, majd a `cash-entry-owner-notifications.sql` tartalmát, és telepítsd a `functions/cash-alerts/index.ts` Edge Functiont JWT-ellenőrzés nélkül; a függvény saját maga hitelesíti a felhasználói és adatbázis-webhook kéréseket.

Az adatbázis-szabályok biztosítják, hogy a dolgozók csak a saját soraikat, Ági és Tamás pedig minden sort lásson.
