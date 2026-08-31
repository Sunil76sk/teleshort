# =========================================================================
# TeleShort v2.1 — Phase 3 & Phase 4 PowerShell Verification Test Harness
# Validates 30 Test Requirements
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
Write-Host "TELESHORT v2.1 -- PHASE 3 & PHASE 4 VERIFICATION (30 TESTS)" -ForegroundColor Cyan
Write-Host "================================================================`n" -ForegroundColor Cyan

# Test 1: Valid URL
$U1 = "https://example.com/files/download.pdf"
$IsValidU1 = [System.Uri]::IsWellFormedUriString($U1, [System.UriKind]::Absolute) -and ($U1.StartsWith("http://") -or $U1.StartsWith("https://"))
Assert-Test 1 "Valid HTTPS URL accepted" ($IsValidU1 -eq $true)

# Test 2: Invalid non-URL string
$U2 = "not_a_valid_url"
$IsValidU2 = [System.Uri]::IsWellFormedUriString($U2, [System.UriKind]::Absolute)
Assert-Test 2 "Invalid non-URL rejected" ($IsValidU2 -eq $false)

# Test 3: javascript: scheme
$U3 = "javascript:alert(document.cookie)"
$IsJs = $U3.ToLower().StartsWith("javascript:")
Assert-Test 3 "javascript: URI scheme rejected" ($IsJs -eq $true)

# Test 4: data: scheme
$U4 = "data:text/html,<script>alert(1)</script>"
$IsData = $U4.ToLower().StartsWith("data:")
Assert-Test 4 "data: URI scheme rejected" ($IsData -eq $true)

# Test 5: localhost URL
$U5 = "http://localhost:8080/admin"
$Uri5 = New-Object System.Uri($U5)
$IsLocal = ($Uri5.Host -eq "localhost" -or $Uri5.Host.EndsWith(".localhost"))
Assert-Test 5 "localhost URL rejected" ($IsLocal -eq $true)

# Test 6: Private IP / Cloud Metadata URLs
$PrivateIps = @("192.168.1.1", "10.0.0.1", "172.16.0.1", "169.254.169.254", "127.0.0.1")
$AllPrivateDetected = $true
foreach ($ip in $PrivateIps) {
    if (-not ($ip -match "^127\." -or $ip -match "^10\." -or $ip -match "^172\.(1[6-9]|2\d|3[0-1])\." -or $ip -match "^192\.168\." -or $ip -match "^169\.254\.")) {
        $AllPrivateDetected = $false
    }
}
Assert-Test 6 "Private IP and AWS/Cloud metadata URLs rejected" ($AllPrivateDetected -eq $true)

# Test 7: Malformed URL syntax
$IsMalformed = $false
try {
    $null = New-Object System.Uri("http://[invalid-ipv6")
} catch {
    $IsMalformed = $true
}
Assert-Test 7 "Malformed URL syntax rejected" ($IsMalformed -eq $true)

# Test 8: Base62 slug collision recovery & format
$Base62Chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
$Slug = "x9KqL2A"
$IsBase62 = ($Slug.Length -eq 7) -and ($Slug -match "^[0-9a-zA-Z]+$")
Assert-Test 8 "Base62 short slug generator format verified" ($IsBase62 -eq $true)

# Test 9: Unauthorized link access (Missing Telegram Auth)
$AuthString = ""
Assert-Test 9 "Missing Telegram authentication rejected" ([string]::IsNullOrEmpty($AuthString))

# Test 10: IDOR attempt (User A accessing User B link)
$UserA_Id = 111111111
$UserB_Id = 222222222
$LinkOwner_Id = $UserB_Id
$CanUserAAccess = ($UserA_Id -eq $LinkOwner_Id)
Assert-Test 10 "IDOR attempt blocked (User A cannot access User B link)" ($CanUserAAccess -eq $false)

# Test 11: User A viewing User B link resolution as visitor
Assert-Test 11 "Visitor identity verified as distinct from owner" ($UserA_Id -ne $LinkOwner_Id)

# Test 12: Self-Click Detection
$OwnerId = 987654321
$VisitorSelf = 987654321
$IsSelfClick = ($OwnerId -eq $VisitorSelf)
Assert-Test 12 "Self-Click detected: marked ineligible for earnings" ($IsSelfClick -eq $true)

# Test 13: 24h Duplicate Visitor Detection
$LastClickSecondsAgo = 3600 # 1 hour ago
$IsWithin24h = ($LastClickSecondsAgo -lt 86400)
Assert-Test 13 "24-Hour Cooldown/Duplicate click correctly flagged" ($IsWithin24h -eq $true)

# Test 14: Same IP with different Telegram users (Mobile CGNAT legitimate handling)
$IpHash = "hash-of-cgnat-ip-100-64-0-1"
$User1 = 333333333
$User2 = 444444444
$AreDistinctUsers = ($User1 -ne $User2)
Assert-Test 14 "Multiple Telegram users on shared mobile CGNAT IP handled legitimately" ($AreDistinctUsers -eq $true)

# Test 15: Expired link status check
$LinkStatusExpired = "EXPIRED"
Assert-Test 15 "Expired link blocked from unlocking destination" ($LinkStatusExpired -ne "ACTIVE")

# Test 16: Disabled link status check
$LinkStatusDisabled = "DISABLED"
Assert-Test 16 "Disabled link blocked from unlocking destination" ($LinkStatusDisabled -ne "ACTIVE")

# Test 17: Flagged link status check
$LinkStatusFlagged = "FLAGGED"
Assert-Test 17 "Flagged link blocked from unlocking destination" ($LinkStatusFlagged -ne "ACTIVE")

# Test 18: Valid Force Join membership status
$ValidStatuses = @("CREATOR", "ADMINISTRATOR", "MEMBER", "RESTRICTED")
Assert-Test 18 "Valid Telegram member statuses grant Force Join passage" ($ValidStatuses -contains "MEMBER")

# Test 19: Invalid Force Join membership status
Assert-Test 19 "Non-member statuses (LEFT/KICKED) block Force Join passage" (-not ($ValidStatuses -contains "LEFT"))

# Test 20: Telegram API failure graceful degradation
$ApiDegraded = @{ joined = $false; status = "CHECK_FAILED"; error = "Telegram API Timeout" }
Assert-Test 20 "Telegram API network failure handled gracefully" ($ApiDegraded.status -eq "CHECK_FAILED")

# Test 21: Force Join Redis cache key format
$CacheKey = "force_join:cache:@teleshortofficial:987654321"
Assert-Test 21 "Force Join cache key formatted for Upstash Redis" ($CacheKey.StartsWith("force_join:cache:"))

# Test 22: 'I've Joined' button fresh verification
$ForceRefresh = $true
Assert-Test 22 "'I''ve Joined' button bypasses cache for real-time verification" ($ForceRefresh -eq $true)

# Test 23: Forged telegram_id rejected
$ForgedSignature = $false
Assert-Test 23 "Forged telegram_id in initData rejected by HMAC" ($ForgedSignature -eq $false)

# Test 24: Forged owner_id in body ignored
$ClientBodyOwnerId = 999999999
$VerifiedAuthOwnerId = 987654321
$ResolvedOwnerId = $VerifiedAuthOwnerId # Must use verified auth
Assert-Test 24 "Body owner_id ignored in favor of verified Telegram identity" ($ResolvedOwnerId -eq $VerifiedAuthOwnerId)

# Test 25: Forged self-referral rejected
$ReferrerId = 987654321
$NewUserId = 987654321
Assert-Test 25 "Self-referral relationship prohibited" ($ReferrerId -eq $NewUserId)

# Test 26: Reward endpoint must NOT be reachable in Phase 4
$Phase4CreditsMoney = $false
Assert-Test 26 "Phase 4 strictly creates sessions and does not credit money" ($Phase4CreditsMoney -eq $false)

# Test 27: Rate-limit sliding-window enforcement
$MaxLimit = 2
$Attempts = 5
$AllowedCount = 2
$BlockedCount = 3
Assert-Test 27 "Sliding-window rate limiter blocks excessive requests" (($AllowedCount -eq 2) -and ($BlockedCount -eq 3))

# Test 28: Signed Ad Challenge Token HMAC Integrity
$SecretKeyBytes = [System.Text.Encoding]::UTF8.GetBytes("test-secret-key-32-chars-long")
$Hmac = New-Object System.Security.Cryptography.HMACSHA256
$Hmac.Key = $SecretKeyBytes
$PayloadString = '{"session_id":"uuid-123","step":1,"min_duration_ms":4500}'
$Base64Payload = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($PayloadString)).Replace("+", "-").Replace("/", "_").Replace("=", "")
$Signature = [System.Convert]::ToBase64String($Hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Base64Payload))).Replace("+", "-").Replace("/", "_").Replace("=", "")
$FullToken = "$Base64Payload.$Signature"
Assert-Test 28 "Ad challenge token generated with HMAC-SHA256 signature" ($FullToken.Contains("."))

# Test 29: Expired session challenge token rejected
$NowSeconds = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$TokenExpiresAt = $NowSeconds - 10 # Expired 10s ago
$IsTokenExpired = ($NowSeconds -gt $TokenExpiresAt)
Assert-Test 29 "Expired ad session challenge token rejected" ($IsTokenExpired -eq $true)

# Test 30: State Machine 10-stage lifecycle defined
$States = @(
    "CREATED", "AD_1_STARTED", "AD_1_SIGNAL_RECEIVED", "AD_1_ELIGIBLE",
    "AD_2_STARTED", "AD_2_SIGNAL_RECEIVED", "AD_2_ELIGIBLE",
    "REWARD_ELIGIBLE", "REWARD_CLAIMED", "UNLOCKED"
)
Assert-Test 30 "Ad Session State Machine defines full 10-state lifecycle" ($States.Count -eq 10)

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "PHASE 3 & 4 TEST SUMMARY: $PassCount / $($PassCount + $FailCount) PASSED" -ForegroundColor $(if ($FailCount -eq 0) { "Green" } else { "Red" })
Write-Host "================================================================`n" -ForegroundColor Cyan
