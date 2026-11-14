# Builds a signed release APK of the assistant without Gradle: Android SDK build tools + JDK 17.
# Run from PowerShell:  powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = "Stop"
$root  = $PSScriptRoot
$sdk   = "$env:LOCALAPPDATA\Android\Sdk"
$bt    = "$sdk\build-tools\34.0.0"
$jar   = "$sdk\platforms\android-34\android.jar"
$jdk   = (Get-ChildItem "$root\tools" -Directory -Filter "jdk-17*" | Select-Object -First 1).FullName
$env:JAVA_HOME = $jdk
$env:PATH = "$jdk\bin;$env:PATH"

$appId = "ru.home.pomoshnik"; $versionCode = 1; $versionName = "1.0"
$web   = "$root\приложение"
$main  = "$root\android-app\app\src\main"
$key   = "$root\ключ\pomoshnik-release.jks"
$pass  = "$root\ключ\пароль.txt"
$out   = "$root\Pomoshnik-1.0-release.apk"

function Run($exe) { & $exe @args; if ($LASTEXITCODE -ne 0) { throw "$exe failed ($LASTEXITCODE)" } }

# aapt2 is a native tool and is unreliable with non-Latin paths, so stage everything in an ASCII temp folder
$w = Join-Path ([IO.Path]::GetTempPath()) "pomoshnik-build"
if (Test-Path $w) { Remove-Item $w -Recurse -Force }
New-Item -ItemType Directory "$w\gen","$w\classes","$w\dex","$w\assets" | Out-Null
Copy-Item "$main\res" "$w\res" -Recurse
Copy-Item "$main\java" "$w\java" -Recurse
Copy-Item "$web\*" "$w\assets" -Recurse
# the manifest has no package attribute (Gradle adds it from `namespace`), so add it here
$m = Get-Content "$main\AndroidManifest.xml" -Raw -Encoding UTF8
$m = $m -replace '<manifest ', "<manifest package=`"$appId`" "
[IO.File]::WriteAllText("$w\AndroidManifest.xml", $m)

Push-Location $w
try {
  "1/6 resources"
  Run "$bt\aapt2.exe" compile --dir res -o res.zip
  Run "$bt\aapt2.exe" link -o unsigned.apk -I $jar --manifest AndroidManifest.xml --java gen `
      --min-sdk-version 26 --target-sdk-version 34 --version-code $versionCode --version-name $versionName res.zip
  "2/6 java"
  $src = Get-ChildItem java,gen -Recurse -Filter *.java | ForEach-Object { $_.FullName }
  Run "$jdk\bin\javac.exe" -encoding UTF-8 -source 17 -target 17 -nowarn "-Xlint:-options" -classpath $jar -d classes @src
  "3/6 dex"
  $cls = Get-ChildItem classes -Recurse -Filter *.class | ForEach-Object { $_.FullName }
  Run "$bt\d8.bat" --release --min-api 26 --lib $jar --output dex @cls
  "4/6 package"
  # added by hand: aapt/aapt2 on Windows store nested asset paths with backslashes, which Android cannot open
  Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::Open("$w\unsigned.apk", "Update")
  try {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, "$w\dex\classes.dex", "classes.dex") | Out-Null
    foreach ($f in Get-ChildItem "$w\assets" -Recurse -File) {
      $name = "assets/" + $f.FullName.Substring("$w\assets\".Length).Replace('\', '/')
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $name) | Out-Null
    }
  } finally { $zip.Dispose() }
  "5/6 align"
  Run "$bt\zipalign.exe" -p -f 4 unsigned.apk aligned.apk
  "6/6 sign"
  Run "$bt\apksigner.bat" sign --ks $key --ks-key-alias pomoshnik --ks-pass "file:$pass" --out signed.apk aligned.apk
  Run "$bt\apksigner.bat" verify signed.apk
  Copy-Item signed.apk $out -Force
} finally { Pop-Location }
Remove-Item $w -Recurse -Force
"Готово: $out"
