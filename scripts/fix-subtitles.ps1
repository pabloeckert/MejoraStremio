param(
    [Parameter(Mandatory=$true)] [string]$Email,
    [Parameter(Mandatory=$true)] [string]$Password,
    [Parameter(Mandatory=$true)] [string]$SubSenseUrl
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Has-SubsResource($mf) {
    if (-not $mf -or -not $mf.resources) { return $false }
    foreach ($r in $mf.resources) {
        if ($r -is [string] -and $r -eq "subtitles") { return $true }
        if ($r -isnot [string] -and $r.name -eq "subtitles") { return $true }
    }
    return $false
}

# === PASO 1: LOGIN ===
Write-Host "PASO 1: LOGIN" -ForegroundColor Cyan
$loginBody = "{`"type`":`"Login`",`"email`":`"$Email`",`"password`":`"$Password`"}"
$r1 = Invoke-RestMethod "https://api.strem.io/api/login" -Method Post -ContentType "application/json" -Body $loginBody

if (-not $r1.result -or -not $r1.result.authKey) {
    Write-Host "FALLO LOGIN: $($r1 | ConvertTo-Json)" -ForegroundColor Red; exit 1
}
$A = $r1.result.authKey
Write-Host "  OK - AuthKey obtenida: $($A.Substring(0,10))..."

# === PASO 2: BACKUP ===
Write-Host ""
Write-Host "PASO 2: BACKUP" -ForegroundColor Cyan
$r2 = Invoke-RestMethod "https://api.strem.io/api/addonCollectionGet" -Method Post -ContentType "application/json" `
    -Body "{`"type`":`"AddonCollectionGet`",`"authKey`":`"$A`",`"update`":true}"

if (-not $r2.result -or -not $r2.result.addons) {
    Write-Host "FALLO: no se pudo obtener coleccion" -ForegroundColor Red; exit 1
}
$CURR = $r2.result.addons
$bd = "C:\Github\MejoraStremio\.backups"
if (-not (Test-Path $bd)) { New-Item -ItemType Directory -Force $bd | Out-Null }
$bf = "$bd\backup-stremio-$(Get-Date -f 'yyyy-MM-dd-HHmmss')-pre-subs.json"
$r2.result | ConvertTo-Json -Depth 20 | Out-File $bf -Encoding utf8
Write-Host "  OK - $bf"
$cnt = $CURR.Count
Write-Host "  Coleccion actual ($cnt addons):"
for ($i=0; $i -lt $CURR.Count; $i++) {
    $n = if($CURR[$i].manifest -and $CURR[$i].manifest.name){$CURR[$i].manifest.name}else{$CURR[$i].transportName}
    $pos = $i + 1
    Write-Host "    $pos. $n"
}

# === PASO 3: VERIFICAR MANIFESTS NUEVOS ===
Write-Host ""
Write-Host "PASO 3: VERIFICAR MANIFESTS" -ForegroundColor Cyan

$manifestUrl = if ($SubSenseUrl -match "manifest\.json$") { $SubSenseUrl } else { $SubSenseUrl.TrimEnd('/') + "/manifest.json" }

$candidates = @(
    @{id="subsense";  url=$manifestUrl; label="SubSense"},
    @{id="subsource"; url="https://subsource.strem.bar/manifest.json"; label="SubSource"},
    @{id="subdl";     url="https://subdl.strem.bar/manifest.json"; label="SubDL"},
    @{id="community"; url="https://stremio-community-subtitles.top/manifest.json"; label="Stremio Community Subtitles"}
)

$VALID = [System.Collections.ArrayList]::new()
$MR = @{}

foreach ($c in $candidates) {
    Write-Host "  $($c.label)... " -NoNewline
    try {
        $m = Invoke-RestMethod $c.url -Method Get -TimeoutSec 25
        if (Has-SubsResource $m) {
            Write-Host "OK ($($m.name))" -ForegroundColor Green
            $tu = $c.url -replace "/manifest\.json$", "/"
            [void]$VALID.Add([PSCustomObject]@{
                id=$c.id; label=$c.label
                transportUrl=$tu; transportName=$m.name
                manifest=$m
                flags=[PSCustomObject]@{official=$false; protected=$false}
            })
            $MR[$c.id] = "OK - $($m.name)"
        } else {
            Write-Host "WARN: sin subtitles en resources" -ForegroundColor Yellow
            $MR[$c.id] = "WARN: sin subtitles en resources"
        }
    } catch {
        Write-Host "FALLO: $($_.Exception.Message)" -ForegroundColor Red
        $MR[$c.id] = "FALLO: $($_.Exception.Message)"
    }
}
$vc = $VALID.Count
Write-Host "  Validos: $vc/4"

# === PASO 4: DIAGNOSTICO OPENSUBTITLES PRO ===
Write-Host ""
Write-Host "PASO 4: DIAGNOSTICO OPENSUBTITLES PRO" -ForegroundColor Cyan
$osIdx = -1
for ($i=0; $i -lt $CURR.Count; $i++) {
    $n = if($CURR[$i].manifest -and $CURR[$i].manifest.name){$CURR[$i].manifest.name}else{$CURR[$i].transportName}
    $u = $CURR[$i].transportUrl
    if ($n -like "*OpenSubtitles*" -or $n -like "*opensubtitles*" -or ($u -and $u -like "*opensubtitles*")) {
        $osIdx = $i; break
    }
}

$osDiag = "NO ENCONTRADO"
if ($osIdx -ge 0) {
    $osAddon = $CURR[$osIdx]
    $osUrl   = $osAddon.transportUrl
    $osName  = if($osAddon.manifest -and $osAddon.manifest.name){$osAddon.manifest.name}else{$osAddon.transportName}
    $osPos   = $osIdx + 1
    Write-Host "  Encontrado en posicion ${osPos}: $osName"
    Write-Host "  TransportUrl: $osUrl"
    $decoded = [System.Uri]::UnescapeDataString($osUrl)
    Write-Host "  URL decodificada: $decoded"

    if ($decoded -match "es-419|es-AR|es-MX|es-ES|/es/|lang=es|languages=es|subtitleLanguages=es") {
        $osDiag = "TIENE espanol configurado (match: $($Matches[0]))"
    } elseif ($decoded -match "lang|language|subtitle") {
        $osDiag = "Tiene parametros de idioma pero NO incluye espanol visible"
    } else {
        $osDiag = "Sin configuracion de idioma en URL - probablemente NO configurado para espanol"
    }
    $diagColor = if($osDiag -like "*TIENE*"){"Green"}else{"Yellow"}
    Write-Host "  Diagnostico: $osDiag" -ForegroundColor $diagColor

    try {
        $osMfUrl = $osUrl.TrimEnd('/') + '/manifest.json'
        $osMf = Invoke-RestMethod $osMfUrl -TimeoutSec 15
        Write-Host "  Manifest: $($osMf.name) v$($osMf.version)"
        $resNames = $osMf.resources | ForEach-Object { if ($_ -is [string]) { $_ } else { $_.name } }
        Write-Host "  Resources: $($resNames -join ', ')"
    } catch {
        Write-Host "  Manifest fresco: FALLO - $($_.Exception.Message)"
    }
} else {
    Write-Host "  OPENSUBTITLES PRO NO ENCONTRADO en la coleccion" -ForegroundColor Red
}

# === PASO 5: ARMAR NUEVA COLECCION ===
Write-Host ""
Write-Host "PASO 5: ARMAR NUEVA COLECCION" -ForegroundColor Cyan
$NEW = [System.Collections.ArrayList]::new()

$insertBefore = if ($osIdx -ge 0) { $osIdx } else { [Math]::Min(8, $CURR.Count) }

for ($i=0; $i -lt $insertBefore; $i++) { [void]$NEW.Add($CURR[$i]) }

$ss  = $VALID | Where-Object {$_.id -eq "subsense"}  | Select-Object -First 1
$src = $VALID | Where-Object {$_.id -eq "subsource"} | Select-Object -First 1
$sdl = $VALID | Where-Object {$_.id -eq "subdl"}     | Select-Object -First 1
$com = $VALID | Where-Object {$_.id -eq "community"} | Select-Object -First 1

if ($ss)           { [void]$NEW.Add($ss);           Write-Host "  + SubSense" }
if ($osIdx -ge 0)  { [void]$NEW.Add($CURR[$osIdx]); Write-Host "  + OpenSubtitles PRO (mantenido)" }
if ($src)          { [void]$NEW.Add($src);           Write-Host "  + SubSource" }
if ($sdl)          { [void]$NEW.Add($sdl);           Write-Host "  + SubDL" }
if ($com)          { [void]$NEW.Add($com);           Write-Host "  + Stremio Community Subtitles" }

$afterIdx = if ($osIdx -ge 0) { $osIdx + 1 } else { $insertBefore }
for ($i=$afterIdx; $i -lt $CURR.Count; $i++) { [void]$NEW.Add($CURR[$i]) }

$nc = $NEW.Count
Write-Host ""
Write-Host "  Nueva coleccion ($nc addons):"
for ($i=0; $i -lt $NEW.Count; $i++) {
    $a = $NEW[$i]
    $n = if($a.manifest -and $a.manifest.name){$a.manifest.name}elseif($a.transportName){$a.transportName}else{$a.label}
    $pos = $i + 1
    Write-Host "    $pos. $n"
}

# === PASO 6: ESCRIBIR COLECCION ===
Write-Host ""
Write-Host "PASO 6: ESCRIBIR COLECCION" -ForegroundColor Cyan

$apiArr = @($NEW | ForEach-Object {
    $a = $_
    $tName = if($a.transportName){$a.transportName}elseif($a.manifest -and $a.manifest.name){$a.manifest.name}else{""}
    $fl    = if($a.flags){$a.flags}else{[PSCustomObject]@{official=$false; protected=$false}}
    [PSCustomObject]@{
        transportUrl  = $a.transportUrl
        transportName = $tName
        manifest      = $a.manifest
        flags         = $fl
    }
})

$setPayload = [PSCustomObject]@{ type="AddonCollectionSet"; authKey=$A; addons=$apiArr }
$setBody    = $setPayload | ConvertTo-Json -Depth 40 -Compress

$r5 = Invoke-RestMethod "https://api.strem.io/api/addonCollectionSet" -Method Post -Body $setBody -ContentType "application/json"
Write-Host "  Respuesta: $($r5 | ConvertTo-Json -Depth 3)"

# === PASO 7: VERIFICACION ===
Write-Host ""
Write-Host "PASO 7: VERIFICACION" -ForegroundColor Cyan
$r6 = Invoke-RestMethod "https://api.strem.io/api/addonCollectionGet" -Method Post -ContentType "application/json" `
    -Body "{`"type`":`"AddonCollectionGet`",`"authKey`":`"$A`",`"update`":true}"

if ($r6.result -and $r6.result.addons) {
    $fc = $r6.result.addons.Count
    Write-Host "  Coleccion verificada ($fc addons):" -ForegroundColor Green
    for ($i=0; $i -lt $r6.result.addons.Count; $i++) {
        $n = if($r6.result.addons[$i].manifest -and $r6.result.addons[$i].manifest.name){$r6.result.addons[$i].manifest.name}else{$r6.result.addons[$i].transportName}
        $pos = $i + 1
        Write-Host "    $pos. $n"
    }
} else {
    Write-Host "  No se pudo verificar: $($r6 | ConvertTo-Json)" -ForegroundColor Red
}

# Test de subtitulos
Write-Host ""
Write-Host "  Test de subtitulos en espanol:" -ForegroundColor Yellow
$testAddons = @($NEW | Where-Object {
    $n = if($_.manifest -and $_.manifest.name){$_.manifest.name}elseif($_.transportName){$_.transportName}else{$_.label}
    $n -like "*Sub*" -or $n -like "*OpenSub*" -or $n -like "*subtitle*"
})

foreach ($ta in $testAddons) {
    $turl = $ta.transportUrl
    $tn   = if($ta.manifest -and $ta.manifest.name){$ta.manifest.name}elseif($ta.transportName){$ta.transportName}else{$ta.label}
    Write-Host ""
    Write-Host "  --- $tn ---"

    try {
        $bb = Invoke-RestMethod "$($turl)subtitles/series/tt0959621:1:1.json" -TimeoutSec 30
        $bbAll = if($bb.subtitles){$bb.subtitles.Count}else{0}
        $bbEs  = if($bb.subtitles){@($bb.subtitles | Where-Object {$_.lang -match "^es"}).Count}else{0}
        $bbLangs = if($bb.subtitles -and $bbEs -gt 0){ (($bb.subtitles | Where-Object {$_.lang -match "^es"} | Select-Object -ExpandProperty lang) | Sort-Object -Unique) -join ", " }else{"ninguno"}
        Write-Host "    Breaking Bad S01E01: $bbAll total, $bbEs en espanol ($bbLangs)"
    } catch { Write-Host "    Breaking Bad: FALLO - $($_.Exception.Message)" }

    try {
        $mat = Invoke-RestMethod "$($turl)subtitles/movie/tt0133093.json" -TimeoutSec 30
        $matAll = if($mat.subtitles){$mat.subtitles.Count}else{0}
        $matEs  = if($mat.subtitles){@($mat.subtitles | Where-Object {$_.lang -match "^es"}).Count}else{0}
        $matLangs = if($mat.subtitles -and $matEs -gt 0){ (($mat.subtitles | Where-Object {$_.lang -match "^es"} | Select-Object -ExpandProperty lang) | Sort-Object -Unique) -join ", " }else{"ninguno"}
        Write-Host "    The Matrix: $matAll total, $matEs en espanol ($matLangs)"
    } catch { Write-Host "    The Matrix: FALLO - $($_.Exception.Message)" }
}

# === REPORTE FINAL ===
Write-Host ""
Write-Host "========== REPORTE FINAL ==========" -ForegroundColor Cyan
Write-Host "1. BACKUP: $bf"
Write-Host "2. MANIFESTS:"
foreach ($k in $MR.Keys) { Write-Host "   $k : $($MR[$k])" }
Write-Host "3. OPENSUBTITLES PRO: $osDiag"
Write-Host "4. Coleccion total: $nc addons"
Write-Host ""
Write-Host "[Sesion limpiada]"
$A = $null
