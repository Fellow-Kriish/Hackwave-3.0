@echo off
rem HackWave demo menu: double-click to open. Every option runs the same pnpm commands the README lists.
setlocal EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
title HackWave - intent-based self-healing E2E testing

where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm is not installed. Install Node 20.19+ and then: npm install -g pnpm@10
  pause
  exit /b 1
)
if not exist node_modules (
  echo First run on this machine: installing dependencies and the browser ^(about a minute^)...
  call pnpm -s bootstrap
)

rem "demo-menu.bat 3" runs one option and exits, without the menu (a shortcut, and how the menu is tested).
set "once="
if not "%~1"=="" (
  set "once=1"
  set "choice=%~1"
  goto dispatch
)

:menu
cls
echo.
echo   ===============================================================
echo    HackWave  -  tests that describe intent, heal their own path,
echo                 and cannot lie about the outcome
echo   ===============================================================
echo.
call :shopstatus
echo.
echo    SET UP
echo     1  Start the three shops (opens a new window; leave it open)
echo     2  Preflight check (doctor)
echo.
echo    THE WEB APP  (start here)
echo     U  Open the web app: type a goal, pick a version, watch the AI test it
echo        (its Guided demo button runs the whole story from one typed goal)
echo.
echo    THE DEMO  (offline, from saved AI answers; no internet, no API key)
echo     3  Run the demo: 4 acts, with the line to say before each
echo     4  Run the demo + act 5: an order saved at the wrong price
echo     5  Run the demo and record a video of each act
echo     F  Same-address demo: deploy Version A, then switch the SAME URL to Version B
echo     6  Open the reports of the last demo in the browser
echo.
echo    YOUR OWN TEST  (needs internet and the key in .env: a new sentence is planned by the AI)
echo     T  Type a goal in plain words and test it, e.g. "Complete checkout with a valid credit card"
echo     E  Explore ANY website (e.g. amazon.in): it plans and clicks, but checks nothing, so UNVERIFIED
echo.
echo    SHOW MORE
echo     7  Readable errors: lint a deliberately broken test file
echo     8  Self-tests for the demo acts (about 1 minute)
echo     9  All 20 self-tests (about 5 minutes)
echo     L  Live AI check (needs internet and the key in .env)
echo     W  What to say in each act
echo.
echo     S  Stop the shops          Q  Quit
echo.
set "choice="
set /p "choice=   Choose: "
if not defined choice goto menu

:dispatch
if /i "%choice%"=="1" goto startshops
if /i "%choice%"=="2" goto doctor
if /i "%choice%"=="3" goto demo
if /i "%choice%"=="4" goto demo5
if /i "%choice%"=="5" goto demovideo
if /i "%choice%"=="F" goto demosameurl
if /i "%choice%"=="U" goto webapp
if /i "%choice%"=="T" goto typegoal
if /i "%choice%"=="E" goto explore
if /i "%choice%"=="6" goto reports
if /i "%choice%"=="7" goto lint
if /i "%choice%"=="8" goto evalacts
if /i "%choice%"=="9" goto evalall
if /i "%choice%"=="L" goto live
if /i "%choice%"=="W" goto script
if /i "%choice%"=="S" goto stopshops
if /i "%choice%"=="Q" goto end
if defined once (
  echo Unknown option "%choice%": use 1-9, F, T, L, W, S or Q.
  goto end
)
goto menu

rem ---------------------------------------------------------------- set up

:startshops
call :shopsup
if not errorlevel 1 (
  echo.
  echo   The shops are already running.
  goto pause
)
echo.
echo   Starting v1, v2 and v2-broken in a new window...
start "HackWave shops - keep this window open" cmd /k "pnpm shop"
call :waitshops
goto pause

:doctor
echo.
call pnpm -s engine doctor
goto pause

rem ---------------------------------------------------------------- the demo

:demo
call :needshops || goto pause
echo.
call pnpm -s demo --cues
goto pause

:demo5
call :needshops || goto pause
echo.
call pnpm -s demo --cues --with-wrong-total
goto pause

:demovideo
call :needshops || goto pause
echo.
call pnpm -s demo --cues --video
goto pause

:demosameurl
rem Runs its own shop at one address and redeploys it between acts; the three shops are not needed.
echo.
call pnpm -s demo --cues --same-url
goto pause

:webapp
rem Runs in its own window (it serves the page until that window is closed) with its own shop; the three shops are not needed.
start "HackWave web app" cmd /k pnpm -s ui
echo.
echo   The web app is starting in a new window and will open in your browser at http://localhost:4321
echo   Close that window to stop it.
goto pause

:explore
echo.
echo   Explore mode works on any website. It plans the steps, clicks and heals as usual,
echo   but nothing checks the result against the site's data, so it reports UNVERIFIED, never a pass.
echo.
set "site="
set /p "site=   Website [https://www.amazon.in/]: "
if not defined site set "site=https://www.amazon.in/"
set "goal="
set /p "goal=   Goal [search for the query and add the first result to the cart]: "
if not defined goal set "goal=search for the query and add the first result to the cart"
set "goal=%goal:"=%"
set "words="
set /p "words=   Words it may type, as query [water bottle]: "
if not defined words set "words=water bottle"
set "words=%words:"=%"
echo.
call pnpm -s engine explore "%goal%" --target %site% --input "query=%words%"
goto pause

:typegoal
echo.
echo   Type what you want to test, in plain words. For example:
echo     Complete checkout with a valid credit card
echo     Buy the City Sneaker and pay with a credit card
echo.
set "goal="
set /p "goal=   Goal: "
if not defined goal goto pause
rem Quotes would break the command line; the goal never needs them.
set "goal=%goal:"=%"
echo.
echo   Test it on which version of the shop?
echo     1  Version A  (v1, the original)
echo     2  Version B  (v2, the redesign)
echo     3  Version B with the backend bug  (v2-broken)
set "ver="
set /p "ver=   Version [1]: "
set "target=http://localhost:5171"
if "%ver%"=="2" set "target=http://localhost:5172"
if "%ver%"=="3" set "target=http://localhost:5173"
call :needshops || goto pause
echo.
call pnpm -s engine try "%goal%" --target %target% --headed --slow-mo 300
goto pause

:reports
set "latest="
for /f "delims=" %%d in ('dir /b /ad /o-d "runs\demo-*" 2^>nul') do (
  if not defined latest set "latest=%%d"
)
if not defined latest (
  echo.
  echo   No demo has run yet. Choose 3 first.
  goto pause
)
echo.
echo   Opening runs\!latest!\index.html
start "" "runs\!latest!\index.html"
goto pause

rem ---------------------------------------------------------------- show more

:lint
rem Under runs\, which git ignores; deleted again right after.
set "broken=runs\broken-intent-example.json"
(
  echo {
  echo   "id": "Bad Intent",
  echo   "goal": "buy",
  echo   "inputs": { "product": "Trail Runner", "card": { "number": 4242 } },
  echo   "oracle": { "state": { "store": "orders", "expectedNewCount": 1, "match": { "total": 1299 } }, "extra": true }
  echo }
) > "%broken%"
echo.
echo   A test file with four mistakes:
echo.
type "%broken%"
echo.
echo   What the linter says:
echo.
call pnpm -s engine lint runs/broken-intent-example.json
del "%broken%" >nul 2>nul
echo.
echo   And the real one:
echo.
call pnpm -s engine lint intents/checkout.json
goto pause

:evalacts
call :needshops || goto pause
echo.
call pnpm -s engine eval v1-baseline v1-cached v2-drift v2-cached v2-broken
goto pause

:evalall
call :needshops || goto pause
echo.
echo   The live provider-switch check is left out here (option L runs it).
rem No exclamation mark in this line: delayed expansion would eat it.
for /f "usebackq delims=" %%n in (`node -e "console.log(require('./evals/fixtures.json').filter((f) => f.providerSwitch === undefined || f.providerSwitch === false).map((f) => f.name).join(' '))"`) do set "names=%%n"
call pnpm -s engine eval !names!
goto pause

:live
call :needshops || goto pause
if not exist .env (
  echo.
  echo   There is no .env with an API key, so the live check cannot run. The demo itself never needs one.
  goto pause
)
echo.
call pnpm -s engine eval provider-switch --headed
goto pause

:script
cls
echo.
echo   ACT 1  v1          GREEN   "This is a normal test. I only wrote the goal; it planned the clicks itself."
echo   ACT 2  v2          AMBER   "Renamed buttons, a reordered flow, a new required field. It healed its own
echo                               path - rung 2, rung 3, and a re-plan - and it wrote the fix."
echo   ACT 3  v2-broken   RED     "Same UI. The page says the order is confirmed. The store says nothing was
echo                               saved. An AI agent would have passed this; my verifier has no AI in it."
echo   ACT 4  v2          GREEN   "Healing is a one-time cost. The cache learned: zero AI calls."
echo   ACT 5  wrong price RED     "Saved, but at the wrong price: 999 instead of 1299. The page never noticed."
echo.
echo   Option F runs the same acts at ONE address: "Here is Version A. Now I deploy Version B to the very same URL,
echo   and run the same test, unchanged." The AMBER report opens with "What changed", in plain words.
echo.
echo   The ladder: 1 saved locator - 2 similarity, no AI - 3 fast AI picks from 8 candidates - 5 re-plan the step.
echo   Pass or fail is decided by plain code reading the orders store, never by the AI.
goto pause

:stopshops
echo.
powershell -NoProfile -Command "$ports = 5171,5172,5173; $c = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue; if (-not $c) { 'No shops were running.'; exit }; foreach ($x in $c) { $p = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $x.OwningProcess); Stop-Process -Id $x.OwningProcess -Force -ErrorAction SilentlyContinue; if ($p) { Stop-Process -Id $p.ParentProcessId -Force -ErrorAction SilentlyContinue } }; 'Stopped the shops on ports 5171-5173.'"
goto pause

rem ---------------------------------------------------------------- helpers

:shopstatus
call :shopsup
if errorlevel 1 (echo    Shops: not running - choose 1) else (echo    Shops: running on localhost:5171 v1, :5172 v2, :5173 v2-broken)
exit /b 0

:shopsup
curl -s -o nul --max-time 2 http://localhost:5171/api/_health || exit /b 1
curl -s -o nul --max-time 2 http://localhost:5172/api/_health || exit /b 1
curl -s -o nul --max-time 2 http://localhost:5173/api/_health || exit /b 1
exit /b 0

:waitshops
for /l %%i in (1,1,60) do (
  call :shopsup
  if not errorlevel 1 (
    echo   The shops are up.
    exit /b 0
  )
  rem One second; timeout would refuse to run when input is redirected.
  ping -n 2 127.0.0.1 >nul
)
echo   The shops did not answer within a minute; look at the shops window for an error.
exit /b 1

:needshops
call :shopsup
if not errorlevel 1 exit /b 0
echo.
echo   The shops are not running yet. Starting them first...
start "HackWave shops - keep this window open" cmd /k "pnpm shop"
call :waitshops
exit /b

:pause
if defined once goto end
echo.
pause
goto menu

:end
endlocal
exit /b 0
