# Díszkertek Kassza

Önálló, mobilbarát, telepíthető PWA a csoportvezetők bevételeinek és kiadásainak kezelésére.

## Funkciók

- név + egyéni PIN-kódos első belépés, készüléken megjegyzett munkamenet;
- minden dolgozó csak a saját kasszáját látja;
- Ági és Tamás teljes, szűrhető statisztikát lát, saját kasszát vezethet, és vezetői belépésből PIN nélkül megnyithatja bármelyik dolgozó kasszáját;
- bevételek, kiadások, szerkesztés és törlés;
- automatikus kasszaegyenleg;
- péntektől csütörtökig tartó heti bontás;
- valós idejű, több készülék közötti Supabase-szinkronizálás;
- minden dolgozónak saját, péntek–csütörtök heti PDF-mentés;
- vezetői szűrt PDF és CSV, valamint teljes JSON biztonsági mentés;
- telepítés és alkalmazáson belüli frissítés.

## Supabase

Az adatbázis létrehozásának lépései a [`supabase/README.md`](supabase/README.md) fájlban találhatók. A böngészőbe kizárólag a nyilvános Project URL és publishable/anon kulcs kerülhet. A `service_role` kulcsot tilos GitHubra feltölteni.

## Telepítés

A GitHub Pages cím megnyitása után a **Telepítés** gombbal az app a telefon kezdőképernyőjére tehető. Új verziónál a **Frissítés** gomb tölti le a legutóbbi fájlokat.

## Biztonsági mentés

Minden dolgozó a **Mentés PDF-ben** gombbal letöltheti az aktuálisan kiválasztott péntek–csütörtök hét saját kasszáját. Ági és Tamás a **Teljes mentés** gombbal az összes elérhető adatot dátumozott JSON-fájlba mentheti; a vezetői PDF- és CSV-mentés az aktuális szűrés eredményét tartalmazza. A mentéseket külön felhőmappában is érdemes megőrizni.
