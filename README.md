# Díszkertek Kassza

Különálló, mobilbarát PWA prototípus a csoportvezetők napi bevételeinek és kiadásainak rögzítésére.

## Helyi indítás

```powershell
python -m http.server 8081 -d kassza-app
```

Ezután nyisd meg: `http://localhost:8081`

## Bemutató használat

- A nyitóoldalon válassz csoportvezetőt. A kiválasztást a böngésző megjegyzi.
- A munkáltatói felület bemutató kódja: `2026`.
- A csoportvezető csak a saját tételeit látja, az admin minden tételben kereshet és CSV-t tölthet le.
- A nevek az `app.js` elején, a `LEADERS` listában módosíthatók.

## Fontos az első verzióról

Ez a verzió helyi prototípus: az adatokat az adott böngésző `localStorage` tárhelyén menti. Emiatt több telefon között még nem szinkronizál élőben, és a bemutató admin kód nem valódi biztonsági védelem. Az éles, közös használathoz adatbázis, szerveroldali jogosultság és biztonságos admin hitelesítés szükséges. Ezeket az önálló GitHub projekt elkészülte után lehet bekötni anélkül, hogy a Munkalap apphoz hozzá kellene nyúlni.
