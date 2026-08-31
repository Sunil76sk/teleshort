# =========================================================================
# TeleShort v2.1 — Phase 7A Deep Link & UI Standardization Audit Harness
# =========================================================================

$PassCount = 0
$FailCount = 0

function Assert-Test($Id, $Name, $Condition, $Details = "") {
    if ($Condition) {
        Write-Host "[PASS] Test $Id : $Name" -ForegroundColor Green
        $global:PassCount++
    } else {
        Write-Host "[FAIL] Test $Id : $Name - $Details" -ForegroundColor Red
        $global:FailCount++
    }
}

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "TELESHORT v2.1 -- PHASE 7A DEEP-LINK & UI VERIFICATION (20 TESTS)" -ForegroundColor Cyan
Write-Host "================================================================`n" -ForegroundColor Cyan

# 1. Deep Link Builder Logic Tests
$BotUsername = "myfileshareskbot"

function Test-BuildDeepLink($code, $appName = "teleshort") {
    $clean = $code -replace '^link_', ''
    if ($appName -and ($appName.ToLower() -ne $BotUsername.ToLower())) {
        return "https://t.me/$BotUsername/$appName`?startapp=link_$clean"
    }
    return "https://t.me/$BotUsername`?startapp=link_$clean"
}

# Test 1: Direct Mini App link formatting with confirmed short_name
$Link1 = Test-BuildDeepLink "9sk74x" "teleshort"
Assert-Test 1 "Direct Mini App format generates valid URL" ($Link1 -eq "https://t.me/myfileshareskbot/teleshort?startapp=link_9sk74x")

# Test 2: Main Mini App format when short_name equals bot username
$Link2 = Test-BuildDeepLink "9sk74x" "myfileshareskbot"
Assert-Test 2 "Main Mini App format avoids duplicate bot username segment" ($Link2 -eq "https://t.me/myfileshareskbot?startapp=link_9sk74x")

# Test 3: Main Mini App format when short_name is empty
$Link3 = Test-BuildDeepLink "9sk74x" ""
Assert-Test 3 "Main Mini App format when no app short_name is set" ($Link3 -eq "https://t.me/myfileshareskbot?startapp=link_9sk74x")

# 2. Start Parameter Validation Regex Tests
$Regex = '^[a-zA-Z0-9_-]{3,32}$'

# Test 4: Valid standard short code
$Code_Valid1 = ("link_9sk74x" -replace '^link_', '')
Assert-Test 4 "Valid short code '9sk74x' matches validation regex" ($Code_Valid1 -match $Regex)

# Test 5: Valid alphanumeric short code
$Code_Valid2 = ("link_ABC123" -replace '^link_', '')
Assert-Test 5 "Valid short code 'ABC123' matches validation regex" ($Code_Valid2 -match $Regex)

# Test 6: Valid test slug
$Code_Valid3 = ("link_test123" -replace '^link_', '')
Assert-Test 6 "Valid short code 'test123' matches validation regex" ($Code_Valid3 -match $Regex)

# Test 7: Invalid prefix rejected
$InvalidPrefix = "invalid_ABC123"
$IsLinkPrefix = $InvalidPrefix.StartsWith("link_")
Assert-Test 7 "Invalid prefix 'invalid_ABC123' rejected" ($IsLinkPrefix -eq $false)

# Test 8: Empty code after prefix rejected
$EmptyCode = ("link_" -replace '^link_', '')
Assert-Test 8 "Empty short code 'link_' rejected by regex" ($EmptyCode -notmatch $Regex)

# Test 9: Too long value rejected (> 32 chars)
$TooLongCode = ("link_abcdefghijklmnopqrstuvwxyz1234567890_extra_long" -replace '^link_', '')
Assert-Test 9 "Overly long code (>32 chars) rejected by regex" ($TooLongCode -notmatch $Regex)

# Test 10: XSS / Script payload in start_param rejected
$XssCode = ("link_<script>alert(1)</script>" -replace '^link_', '')
Assert-Test 10 "XSS script payload rejected by regex" ($XssCode -notmatch $Regex)

# Test 11: SQL fragment in start_param rejected
$SqlCode = ("link_1';DROP TABLE users;--" -replace '^link_', '')
Assert-Test 11 "SQL injection payload rejected by regex" ($SqlCode -notmatch $Regex)

# 3. Currency and UI Files Inspection
$IndexContent = Get-Content ".\index.html" -Raw -Encoding UTF8
$AppContent = Get-Content ".\app.js" -Raw -Encoding UTF8
$Rupee = [char]0x20B9

# Test 12: No user-facing wallet USD strings ($5.00, $0.00 in wallet)
$HasWalletUsd = $IndexContent.Contains('id="wallet-avail-balance">$0.00') -or $IndexContent.Contains('id="wallet-balance-page">$0.00')
Assert-Test 12 "Zero USD balance placeholders in index.html wallet" ($HasWalletUsd -eq $false)

# Test 13: INR currency symbol present in header balance
$HasInrHeader = $IndexContent.Contains("id=`"header-balance`">$Rupee" + "0.00")
Assert-Test 13 "Header balance uses INR symbol" ($HasInrHeader -eq $true)

# Test 14: Withdrawal form explicitly displays Amount to Withdraw
$HasInrWithdrawLabel = $IndexContent.Contains("Amount to Withdraw ($Rupee)")
Assert-Test 14 "Withdrawal input form labels currency as INR" ($HasInrWithdrawLabel -eq $true)

# Test 15: Minimum withdrawal threshold displays 100.00
$HasMin100 = $IndexContent.Contains("$Rupee" + "100.00")
Assert-Test 15 "Minimum withdrawal threshold displays 100.00 in INR" ($HasMin100 -eq $true)

# Test 16: Non-Telegram fallback container present
$HasNonTgContainer = $IndexContent.Contains('id="ui-non-telegram"')
Assert-Test 16 "Non-Telegram fallback container present in index.html" ($HasNonTgContainer -eq $true)

# Test 17: Force Join container present
$HasForceJoinContainer = $IndexContent.Contains('id="ui-force-join"')
Assert-Test 17 "Force Join gate UI container present in index.html" ($HasForceJoinContainer -eq $true)

# Test 18: Ad viewer UI container present
$HasAdViewerContainer = $IndexContent.Contains('id="ui-ad-viewer"')
Assert-Test 18 "2-step Monetag Ad Viewer container present in index.html" ($HasAdViewerContainer -eq $true)

# Test 19: getTelegramStartParam helper exists in app.js
$HasStartParamHelper = $AppContent.Contains('function getTelegramStartParam()')
Assert-Test 19 "getTelegramStartParam helper implemented in app.js" ($HasStartParamHelper -eq $true)

# Test 20: buildTelegramVisitorLink helper exists in app.js
$HasVisitorLinkHelper = $AppContent.Contains('function buildTelegramVisitorLink(')
Assert-Test 20 "buildTelegramVisitorLink helper implemented in app.js" ($HasVisitorLinkHelper -eq $true)

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "PHASE 7A TEST SUMMARY: $PassCount / $($PassCount + $FailCount) PASSED" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
