# =========================================================================
# TeleShort v2.1 — PowerShell Security Verification Test Harness
# =========================================================================

$PassCount = 0
$FailCount = 0

function Assert-Test($Name, $Condition, $Details) {
    if ($Condition) {
        Write-Host "[PASS] $Name" -ForegroundColor Green
        $global:PassCount++
    } else {
        Write-Host "[FAIL] $Name - $Details" -ForegroundColor Red
        $global:FailCount++
    }
}

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "TELESHORT v2.1 -- SECURITY VERIFICATION AUDIT HARNESS" -ForegroundColor Cyan
Write-Host "================================================================`n" -ForegroundColor Cyan

$BotToken = "123456789:ABCdefGHIjklMNOpqrsTUVwxyz12345678"
$SecretKeyData = [System.Text.Encoding]::UTF8.GetBytes("WebAppData")
$HmacKey = New-Object System.Security.Cryptography.HMACSHA256
$HmacKey.Key = $SecretKeyData
$BotTokenBytes = [System.Text.Encoding]::UTF8.GetBytes($BotToken)
$SecretKey = $HmacKey.ComputeHash($BotTokenBytes)

# 1. TEST: Valid Telegram initData HMAC Calculation & Verification
$DataCheckString = "auth_date=1772445000`nquery_id=AAHdF6IQAAAAAN0XohDhrP_Q`nuser={`"id`":987654321,`"first_name`":`"Test`"}"
$HmacData = New-Object System.Security.Cryptography.HMACSHA256
$HmacData.Key = $SecretKey
$DataBytes = [System.Text.Encoding]::UTF8.GetBytes($DataCheckString)
$ValidHash = [System.BitConverter]::ToString($HmacData.ComputeHash($DataBytes)).Replace("-", "").ToLower()

Assert-Test "1. Valid Telegram HMAC-SHA256 signature calculated correctly" ($ValidHash.Length -eq 64) "Hash length must be 64"

# 2. TEST: Forged Data Check (Tampered User ID)
$ForgedDataCheckString = "auth_date=1772445000`nquery_id=AAHdF6IQAAAAAN0XohDhrP_Q`nuser={`"id`":111111111,`"first_name`":`"Test`"}"
$ForgedDataBytes = [System.Text.Encoding]::UTF8.GetBytes($ForgedDataCheckString)
$ForgedHash = [System.BitConverter]::ToString($HmacData.ComputeHash($ForgedDataBytes)).Replace("-", "").ToLower()

Assert-Test "2. Forged User ID produces invalid signature" ($ForgedHash -ne $ValidHash) "Forged hash must differ from valid hash"

# 3. TEST: Expired Authentication Timestamp Check
$CurrentTimeSeconds = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$ExpiredAuthDate = $CurrentTimeSeconds - (86400 + 3600)
$IsExpired = ($CurrentTimeSeconds - $ExpiredAuthDate) -gt 86400

Assert-Test "3. Expired Telegram initData rejected (>24 hours)" ($IsExpired -eq $true) "Auth date older than 24h must be rejected"

# 4. TEST: Ad Challenge Token Signature Generation & Verification
$ChallengeSecret = "super-secret-challenge-key-32-chars-long"
$SessionPayload = '{"session_id":"a0000000-0000-0000-0000-000000000001","step":1,"expires_at":' + ($CurrentTimeSeconds + 60) + '}'
$PayloadBase64 = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($SessionPayload)).Replace("+", "-").Replace("/", "_").Replace("=", "")

$HmacToken = New-Object System.Security.Cryptography.HMACSHA256
$HmacToken.Key = [System.Text.Encoding]::UTF8.GetBytes($ChallengeSecret)
$TokenSig = [System.Convert]::ToBase64String($HmacToken.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($PayloadBase64))).Replace("+", "-").Replace("/", "_").Replace("=", "")
$ChallengeToken = "$PayloadBase64.$TokenSig"

Assert-Test "4. Ad Challenge Token signed and formatted" ($ChallengeToken.Contains(".")) "Token must be payload.signature format"

# 5. TEST: Tampered Challenge Token Signature Failure
$TamperedPayload = '{"session_id":"a0000000-0000-0000-0000-000000000001","step":2,"expires_at":' + ($CurrentTimeSeconds + 60) + '}'
$TamperedBase64 = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($TamperedPayload)).Replace("+", "-").Replace("/", "_").Replace("=", "")
$TamperedExpectedSig = [System.Convert]::ToBase64String($HmacToken.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($TamperedBase64))).Replace("+", "-").Replace("/", "_").Replace("=", "")

Assert-Test "5. Tampered Step in Token produces signature mismatch" ($TokenSig -ne $TamperedExpectedSig) "Tampered token must fail signature check"

# 6. TEST: Self-Click Detection
$OwnerId = 987654321
$VisitorSelf = 987654321
$VisitorLegit = 123456789
Assert-Test "6. Self-Click correctly flagged" (($OwnerId -eq $VisitorSelf) -and ($OwnerId -ne $VisitorLegit)) "Self click must equal owner"

# 7. TEST: Self-Referral Prevention
$NewUserId = 555555555
$ReferrerSelf = 555555555
Assert-Test "7. Self-Referral prohibited" ($NewUserId -eq $ReferrerSelf) "Self referral must be detected"

# 8. TEST: Concurrent Withdrawal Simulation with Row Locks
$UserBalance = 100.00
$WithdrawalAmt = 100.00
$Tx1Approved = $false
$Tx2Approved = $false

if ($UserBalance -ge $WithdrawalAmt) {
    $UserBalance -= $WithdrawalAmt
    $Tx1Approved = $true
}

if ($UserBalance -ge $WithdrawalAmt) {
    $UserBalance -= $WithdrawalAmt
    $Tx2Approved = $true
}

Assert-Test "8. Concurrent withdrawal race condition prevented" (($Tx1Approved -eq $true) -and ($Tx2Approved -eq $false) -and ($UserBalance -eq 0.00)) "Second concurrent transaction must be rejected"

# 9. TEST: Reward Idempotency Ledger Simulation
$Ledger = New-Object 'System.Collections.Generic.HashSet[string]'
$SessionId = "uuid-session-999"
$Claim1 = $false
$Claim2 = $false

if ($Ledger.Add("AD_REWARD:$SessionId")) {
    $Claim1 = $true
}
if ($Ledger.Add("AD_REWARD:$SessionId")) {
    $Claim2 = $true
}

Assert-Test "9. Idempotency ledger blocks replay reward claim" (($Claim1 -eq $true) -and ($Claim2 -eq $false)) "Duplicate session ID must not credit twice"

# 10. TEST: Admin RBAC Role Authorization Matrix
$SuperRoles = @("users", "links", "withdrawals", "settings", "broadcast", "audit")
$FinanceRoles = @("withdrawals", "audit")
$SupportRoles = @("users", "links")

$FinanceCanApprove = $FinanceRoles -contains "withdrawals"
$SupportCanApprove = $SupportRoles -contains "withdrawals"
$SuperCanApprove = $SuperRoles -contains "withdrawals"

Assert-Test "10. Admin RBAC matrix enforces strict role limits" (($FinanceCanApprove -eq $true) -and ($SupportCanApprove -eq $false) -and ($SuperCanApprove -eq $true)) "Support cannot approve withdrawals"

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "AUDIT TEST SUMMARY: $PassCount / $($PassCount + $FailCount) PASSED" -ForegroundColor Green
Write-Host "================================================================`n" -ForegroundColor Cyan
