# Díszkertek Kassza

Önálló, mobilbarát, telepíthető PWA a csoportvezetők bevételeinek és kiadásainak kezelésére.

## Funkciók

- név + egyéni PIN-kódos belépés, megjegyzett munkamenet;
- minden dolgozó csak a saját kasszáját látja;
- Ági és Tamás teljes, szűrhető statisztikát lát és saját kasszát is vezethet;
- bevételek, kiadások, szerkesztés és törlés;
- automatikus kasszaegyenleg;
- péntektől csütörtökig tartó heti bontás;
- valós idejű, több készülék közötti Supabase-szinkronizálás;
- szűrt CSV és teljes JSON biztonsági mentés;
- telepítés és alkalmazáson belüli frissítés.

## Supabase

Az adatbázis létrehozásának lépései a [`supabase/README.md`](supabase/README.md) fájlban találhatók. A böngészőbe kizárólag a nyilvános Project URL és publishable/anon kulcs kerülhet. A `service_role` kulcsot tilos GitHubra feltölteni.

## Telepítés

A GitHub Pages cím megnyitása után a **Telepítés** gombbal az app a telefon kezdőképernyőjére tehető. Új verziónál a **Frissítés** gomb tölti le a legutóbbi fájlokat.

## Biztonsági mentés

Ági és Tamás a **Teljes mentés** gombbal az összes elérhető adatot dátumozott JSON-fájlba mentheti, a **CSV mentés** pedig az aktuális szűrés eredményét tölti le. A mentéseket külön felhőmappában is érdemes megőrizni.
