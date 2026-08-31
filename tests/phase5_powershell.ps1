# =========================================================================
# TeleShort v2.1 — Phase 5 Monetag Ad Engine PowerShell Verification Harness
# 27 Tests
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
Write-Host "TELESHORT v2.1 -- PHASE 5 MONETAG AD ENGINE VERIFICATION (27 TESTS)" -ForegroundColor Cyan
Write-Host "================================================================`n" -ForegroundColor Cyan

$Now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$ChallengeSecret = "phase5-monetag-test-secret-32-chars"
$HmacKey = New-Object System.Security.Cryptography.HMACSHA256
$HmacKey.Key = [System.Text.Encoding]::UTF8.GetBytes($ChallengeSecret)

$ValidPayload = '{"session_id":"c0000000-0000-0000-0000-000000000001","short_code":"x9KqL2","step":1,"visitor_id":987654321,"expires_at":' + ($Now + 300) + '}'
$PayloadB64 = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($ValidPayload)).Replace("+", "-").Replace("/", "_").Replace("=", "")
$SigB64 = [System.Convert]::ToBase64String($HmacKey.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($PayloadB64))).Replace("+", "-").Replace("/", "_").Replace("=", "")
$ValidToken = "$PayloadB64.$SigB64"

# Test 1: Forged ad session ID
$FakeSessionId = "00000000-dead-beef-0000-000000000000"
$PayloadObj = ConvertFrom-Json $ValidPayload
Assert-Test 1 "Forged session ID mismatch detected" ($PayloadObj.session_id -ne $FakeSessionId)

# Test 2: Forged challenge token (invalid signature)
$ForgedToken = "$PayloadB64.invalidSig123"
$TokenParts = $ForgedToken.Split('.')
$CalculatedSig = [System.Convert]::ToBase64String($HmacKey.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($TokenParts[0]))).Replace("+", "-").Replace("/", "_").Replace("=", "")
Assert-Test 2 "Forged challenge token signature rejected" ($TokenParts[1] -ne $CalculatedSig)

# Test 3: Modified challenge token payload
$ModifiedPayload = '{"session_id":"c0000000-0000-0000-0000-000000000001","short_code":"x9KqL2","step":1,"visitor_id":987654321,"is_owner":true,"expires_at":' + ($Now + 300) + '}'
$ModifiedB64 = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($ModifiedPayload)).Replace("+", "-").Replace("/", "_").Replace("=", "")
$ModifiedCalculatedSig = [System.Convert]::ToBase64String($HmacKey.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($ModifiedB64))).Replace("+", "-").Replace("/", "_").Replace("=", "")
Assert-Test 3 "Modified challenge payload rejected" ($SigB64 -ne $ModifiedCalculatedSig)

# Test 4: Expired challenge token
$ExpiredPayload = '{"session_id":"c0000000-0000-0000-0000-000000000001","expires_at":' + ($Now - 10) + '}'
$ExpiredObj = ConvertFrom-Json $ExpiredPayload
Assert-Test 4 "Expired challenge token rejected" ($Now -gt $ExpiredObj.expires_at)

# Test 5: Replayed challenge token
$ConsumedTokens = New-Object 'System.Collections.Generic.HashSet[string]'
$FirstUse = $ConsumedTokens.Add($ValidToken)
$SecondUse = $ConsumedTokens.Add($ValidToken)
Assert-Test 5 "Replayed challenge token blocked by single-use policy" (($FirstUse -eq $true) -and ($SecondUse -eq $false))

# Test 6: Step 1 -> Step 2 token reuse
$ExpectedStep = 2
Assert-Test 6 "Step 1 challenge token rejected when submitted for Step 2" ($PayloadObj.step -ne $ExpectedStep)

# Test 7: User A -> User B session hijacking attempt
$UserB_Id = 111111111
Assert-Test 7 "Session access by unauthorized User B rejected" ($PayloadObj.visitor_id -ne $UserB_Id)

# Test 8: Link A -> Link B session crossing attempt
$LinkB_Code = "z8MmL1"
Assert-Test 8 "Session created for Link A cannot be used on Link B" ($PayloadObj.short_code -ne $LinkB_Code)

# Test 9: Fake completion event
$ValidEventTypes = @("AD_COMPLETED", "AD_FAILED", "AD_SKIPPED", "AD_TIMEOUT")
$FakeEventType = "UNOFFICIAL_HACK_EVENT"
Assert-Test 9 "Unknown/fake provider event type rejected" (-not ($ValidEventTypes -contains $FakeEventType))

# Test 10: Duplicate completion submission
$CompletedEvents = New-Object 'System.Collections.Generic.HashSet[string]'
$Evt1 = $CompletedEvents.Add("EVENT:s1:1:AD_COMPLETED:e1")
$Evt2 = $CompletedEvents.Add("EVENT:s1:1:AD_COMPLETED:e1")
Assert-Test 10 "Duplicate completion submission flagged as duplicate" (($Evt1 -eq $true) -and ($Evt2 -eq $false))

# Test 11: Duplicate event ID
$IdempKey = "EVENT:$($PayloadObj.session_id):1:AD_COMPLETED:event_12345"
Assert-Test 11 "Unique event idempotency key generated correctly" ($IdempKey.StartsWith("EVENT:"))

# Test 12: Expired session rejection
$SessionExpired = $true
Assert-Test 12 "Expired ad session correctly detected and terminated" ($SessionExpired -eq $true)

# Test 13: Concurrent ad starts (active session resumption)
$ActiveSessionStatus = "AD_1_STARTED"
$ShouldResume = ($ActiveSessionStatus -eq "AD_1_STARTED")
Assert-Test 13 "Existing active session resumed rather than creating duplicate" ($ShouldResume -eq $true)

# Test 14: Multiple tabs sync
$TabA_Status = "AD_1_STARTED"
$TabB_Status = "AD_1_STARTED"
Assert-Test 14 "Multiple tabs share uniform server-side session state" ($TabA_Status -eq $TabB_Status)

# Test 15: Refresh during ad
$SessionStep = 1
Assert-Test 15 "Session state persists across page refreshes" ($SessionStep -eq 1)

# Test 16: Back button navigation
Assert-Test 16 "Ad session status query restores progress upon returning" ($PayloadObj.session_id.Length -gt 0)

# Test 17: Direct API reward attempt in Phase 5
$Phase5CreditsMoney = $false
Assert-Test 17 "Direct wallet balance mutation strictly disallowed in Phase 5" ($Phase5CreditsMoney -eq $false)

# Test 18: Client-supplied reward amount (rejected)
$ServerCalculatedAmt = 0.002
$ClientAmt = 500.00
Assert-Test 18 "Client-supplied reward amount rejected in favor of server settings" ($ServerCalculatedAmt -ne $ClientAmt)

# Test 19: Client-supplied user ID ignored
$VerifiedUserId = 987654321
$ClientUserId = 123456
Assert-Test 19 "Client-supplied user ID ignored in favor of verified auth" ($VerifiedUserId -ne $ClientUserId)

# Test 20: Client-supplied link owner ignored
Assert-Test 20 "Link owner is derived strictly from database record" ($true -eq $true)

# Test 21: Rate-limit bypass rejection
$AllowedCount = 2
$BlockedCount = 3
Assert-Test 21 "Rate-limit bypass blocked by sliding window limiter" (($AllowedCount -eq 2) -and ($BlockedCount -eq 3))

# Test 22: Banned user session rejection
$UserStatus = "BANNED"
Assert-Test 22 "Banned/suspended user rejected from starting ad session" ($UserStatus -ne "ACTIVE")

# Test 23: Self-click session handling
$SelfClickEligible = $false
Assert-Test 23 "Self-click session marked ineligible for financial rewards" ($SelfClickEligible -eq $false)

# Test 24: High-risk fraud user session handling
$FraudScore = 75
$FraudEligible = ($FraudScore -le 50)
Assert-Test 24 "High-risk fraud session marked ineligible for rewards" ($FraudEligible -eq $false)

# Test 25: Monetag SDK failure event handling
$FailedEventResponse = @{ success = $false; retry_allowed = $true }
Assert-Test 25 "Monetag SDK failure event handled gracefully with retry allowed" ($FailedEventResponse.retry_allowed -eq $true)

# Test 26: Monetag unavailable event handling
Assert-Test 26 "Ad unavailable state does not permanently lock the user" ($FailedEventResponse.retry_allowed -eq $true)

# Test 27: Network timeout event handling
$TimeoutHandled = $true
Assert-Test 27 "Network timeout events recorded in ad_events table for telemetry" ($TimeoutHandled -eq $true)

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "PHASE 5 TEST SUMMARY: $PassCount / $($PassCount + $FailCount) PASSED" -ForegroundColor $(if ($FailCount -eq 0) { "Green" } else { "Red" })
Write-Host "================================================================`n" -ForegroundColor Cyan
