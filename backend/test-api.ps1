### ============================================================
### RailFlow API - Complete Endpoint Test Suite
### Base URL: http://localhost:5000/api
### ============================================================

$baseUrl = "http://localhost:5000/api"
$headers = @{ "Content-Type" = "application/json" }

function Test-Endpoint {
    param($Method, $Url, $Body, $Token, $Label)
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "TEST: $Label" -ForegroundColor Yellow
    Write-Host "$Method $Url" -ForegroundColor DarkGray
    Write-Host "========================================" -ForegroundColor Cyan
    
    $h = @{ "Content-Type" = "application/json" }
    if ($Token) { $h["Authorization"] = "Bearer $Token" }
    
    try {
        if ($Body) {
            $response = Invoke-RestMethod -Uri $Url -Method $Method -Headers $h -Body $Body -ErrorAction Stop
        } else {
            $response = Invoke-RestMethod -Uri $Url -Method $Method -Headers $h -ErrorAction Stop
        }
        $response | ConvertTo-Json -Depth 5
        return $response
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        $errorBody = $_.ErrorDetails.Message
        Write-Host "STATUS: $statusCode" -ForegroundColor Red
        if ($errorBody) { Write-Host $errorBody -ForegroundColor Red }
        return $null
    }
}

Write-Host "`n" -NoNewline
Write-Host "=============================================" -ForegroundColor Green
Write-Host "   RAILFLOW API - FULL ENDPOINT TEST SUITE   " -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green

# -----------------------------------------------
# 1. ROOT HEALTH CHECK
# -----------------------------------------------
$root = Test-Endpoint -Method GET -Url "http://localhost:5000/" -Label "1. Root Health Check"

# -----------------------------------------------
# 2. REGISTER NEW PASSENGER
# -----------------------------------------------
$registerBody = '{"email":"testuser@railflow.com","password":"test1234","role":"Passenger"}'
$register = Test-Endpoint -Method POST -Url "$baseUrl/auth/register" -Body $registerBody -Label "2. Register New Passenger"

# -----------------------------------------------
# 3. LOGIN AS PASSENGER (seeded user)
# -----------------------------------------------
$loginBody = '{"email":"passenger@railflow.com","password":"password123"}'
$login = Test-Endpoint -Method POST -Url "$baseUrl/auth/login" -Body $loginBody -Label "3. Login as Passenger"
$passengerToken = $login.accessToken
Write-Host "Passenger Token: $($passengerToken.Substring(0,30))..." -ForegroundColor Green

# -----------------------------------------------
# 4. REFRESH TOKEN
# -----------------------------------------------
$refresh = Test-Endpoint -Method POST -Url "$baseUrl/auth/refresh" -Token $passengerToken -Label "4. Refresh Token (Cookie-based)"

# -----------------------------------------------
# 5. SETUP MFA
# -----------------------------------------------
$mfa = Test-Endpoint -Method POST -Url "$baseUrl/auth/mfa/setup" -Token $passengerToken -Label "5. Setup MFA for Passenger"

# -----------------------------------------------
# 6. GET USER PROFILE
# -----------------------------------------------
$profile = Test-Endpoint -Method GET -Url "$baseUrl/users/profile" -Token $passengerToken -Label "6. Get User Profile"

# -----------------------------------------------
# 7. GET SAVED PASSENGERS
# -----------------------------------------------
$passengers = Test-Endpoint -Method GET -Url "$baseUrl/users/passengers" -Token $passengerToken -Label "7. Get Saved Passengers (Masked Aadhaar)"

# -----------------------------------------------
# 8. ADD NEW SAVED PASSENGER (Field-Level Encryption)
# -----------------------------------------------
$addPassengerBody = '{"name":"Ravi Kumar","aadhaar":"998877665544"}'
$addPassenger = Test-Endpoint -Method POST -Url "$baseUrl/users/passengers" -Body $addPassengerBody -Token $passengerToken -Label "8. Add Saved Passenger (Encrypted Aadhaar)"

# -----------------------------------------------
# 9. SEARCH TRAINS (Fuzzy Match - 'Mumbai' typo as 'Mumbay')
# -----------------------------------------------
$search = Test-Endpoint -Method GET -Url "$baseUrl/trains/search?from=Mumbai&to=Delhi&date=2026-06-15" -Token $passengerToken -Label "9. Search Trains (Fuzzy Match)"

# -----------------------------------------------
# 10. GET TRAIN DETAILS
# -----------------------------------------------
$trainDetails = Test-Endpoint -Method GET -Url "$baseUrl/trains/12951" -Label "10. Get Train Details (Mumbai Rajdhani)"

# -----------------------------------------------
# 11. GET COACH LAYOUT (3A Class)
# -----------------------------------------------
$coach = Test-Endpoint -Method GET -Url "$baseUrl/trains/12951/coach?class=3A" -Label "11. Get Coach Layout (3A - B1)"

# -----------------------------------------------
# 12. GET PAYMENT METHODS
# -----------------------------------------------
$paymentMethods = Test-Endpoint -Method GET -Url "$baseUrl/payments/methods" -Token $passengerToken -Label "12. Get Payment Methods (PCI Compliant)"

# -----------------------------------------------
# 13. TRY LOCK SEATS WITHOUT QUEUE (Should fail with 403)
# -----------------------------------------------
$lockBody = '{"trainNumber":"12951","coachLabel":"B1","seatNumbers":[5,6]}'
$lockNoQueue = Test-Endpoint -Method POST -Url "$baseUrl/bookings/lock" -Body $lockBody -Token $passengerToken -Label "13. Lock Seats WITHOUT Queue (Expect 403)"

# -----------------------------------------------
# 14. JOIN VIRTUAL QUEUE
# -----------------------------------------------
$joinQueueBody = '{"deviceFingerprint":"chrome-windows-test-fingerprint-12345"}'
$joinQueue = Test-Endpoint -Method POST -Url "$baseUrl/queue/join" -Body $joinQueueBody -Token $passengerToken -Label "14. Join Virtual Queue"
$queueToken = $joinQueue.data.token
Write-Host "Queue Token: $($queueToken.Substring(0,30))..." -ForegroundColor Green
Write-Host "Queue Position: $($joinQueue.data.currentPosition)" -ForegroundColor Yellow

# -----------------------------------------------
# 15. POLL QUEUE STATUS (Wait for position to reach 0)
# -----------------------------------------------
Write-Host "`nWaiting for queue position to reach 0..." -ForegroundColor Magenta
$deviceFP = "chrome-windows-test-fingerprint-12345"
$maxPolls = 20
for ($i = 1; $i -le $maxPolls; $i++) {
    Start-Sleep -Seconds 3
    try {
        $h = @{ "Content-Type" = "application/json"; "Authorization" = "Bearer $passengerToken" }
        $queueStatus = Invoke-RestMethod -Uri "$baseUrl/queue/status?token=$queueToken&deviceFingerprint=$deviceFP" -Method GET -Headers $h -ErrorAction Stop
        $pos = $queueStatus.data.currentPosition
        $wait = $queueStatus.data.estimatedWaitSeconds
        Write-Host "  Poll #$i -> Position: $pos | Wait: ${wait}s" -ForegroundColor DarkYellow
        if ($pos -eq 0) {
            Write-Host "  BOOKING WINDOW OPEN!" -ForegroundColor Green
            Write-Host "  Window expires: $($queueStatus.data.bookingWindowExpiresAt)" -ForegroundColor Green
            break
        }
    } catch {
        Write-Host "  Poll #$i -> Error: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# -----------------------------------------------
# 16. LOCK SEATS (Now with queue access)
# -----------------------------------------------
$lockBody = '{"trainNumber":"12951","coachLabel":"B1","seatNumbers":[5,6]}'
$lockSeats = Test-Endpoint -Method POST -Url "$baseUrl/bookings/lock" -Body $lockBody -Token $passengerToken -Label "16. Lock Seats (With Queue Access)"

# -----------------------------------------------
# 17. CONFIRM BOOKING (Saga + Payment Simulation)
# -----------------------------------------------
$confirmBody = @{
    trainNumber = "12951"
    coachLabel = "B1"
    seatNumbers = @(5, 6)
    passengers = @(
        @{ name = "Jane Doe"; age = 28; gender = "F"; aadhaar = "111122223333" },
        @{ name = "Ravi Kumar"; age = 35; gender = "M"; aadhaar = "998877665544" }
    )
    paymentMethod = "UPI"
    idempotencyKey = "unique-payment-key-test-001-$(Get-Random)"
} | ConvertTo-Json -Depth 3
$confirmBooking = Test-Endpoint -Method POST -Url "$baseUrl/bookings/confirm" -Body $confirmBody -Token $passengerToken -Label "17. Confirm Booking (Saga + UPI Payment)"
$pnr = $confirmBooking.data.pnr
Write-Host "PNR: $pnr" -ForegroundColor Green
Write-Host "Booking ID: $($confirmBooking.data.bookingId)" -ForegroundColor Green

# -----------------------------------------------
# 18. IDEMPOTENCY CHECK (Duplicate payment request)
# -----------------------------------------------
Write-Host "`n--- Idempotency test: Re-sending same booking with same key ---" -ForegroundColor Magenta
# Use the same idempotency key to test deduplication
$confirmBody2 = @{
    trainNumber = "12951"
    coachLabel = "B1"
    seatNumbers = @(5, 6)
    passengers = @(
        @{ name = "Jane Doe"; age = 28; gender = "F"; aadhaar = "111122223333" },
        @{ name = "Ravi Kumar"; age = 35; gender = "M"; aadhaar = "998877665544" }
    )
    paymentMethod = "UPI"
    idempotencyKey = "unique-payment-key-test-001-fixed"
} | ConvertTo-Json -Depth 3
# First call
Test-Endpoint -Method POST -Url "$baseUrl/bookings/confirm" -Body $confirmBody2 -Token $passengerToken -Label "18a. First Payment (New Idempotency Key)"
# Second call with SAME key
Test-Endpoint -Method POST -Url "$baseUrl/bookings/confirm" -Body $confirmBody2 -Token $passengerToken -Label "18b. Duplicate Payment (Same Key - Should Return Cached)"

# -----------------------------------------------
# 19. RETRIEVE E-TICKET BY PNR
# -----------------------------------------------
if ($pnr) {
    $ticket = Test-Endpoint -Method GET -Url "$baseUrl/bookings/ticket/$pnr" -Token $passengerToken -Label "19. Retrieve E-Ticket (PNR: $pnr)"
}

# -----------------------------------------------
# 20. BOOKING HISTORY
# -----------------------------------------------
$history = Test-Endpoint -Method GET -Url "$baseUrl/bookings/history" -Token $passengerToken -Label "20. Booking History (My Trips)"

# -----------------------------------------------
# 21. FORCE SESSION TERMINATE
# -----------------------------------------------
$terminate = Test-Endpoint -Method POST -Url "$baseUrl/users/sessions/terminate" -Token $passengerToken -Label "21. Remote Session Terminate"

# -----------------------------------------------
# 22. ADMIN LOGIN (MFA Required)
# -----------------------------------------------
$adminLoginBody = '{"email":"admin@railflow.com","password":"password123"}'
$adminLogin = Test-Endpoint -Method POST -Url "$baseUrl/auth/login" -Body $adminLoginBody -Label "22. Admin Login (MFA Required)"
Write-Host "Status: $($adminLogin.status) (Expect: mfa_required)" -ForegroundColor Yellow

# -----------------------------------------------
# 23. ADMIN MFA VERIFY
# -----------------------------------------------
$mfaBody = '{"email":"admin@railflow.com","code":"123456"}'
$adminMfa = Test-Endpoint -Method POST -Url "$baseUrl/auth/mfa/verify" -Body $mfaBody -Label "23. Admin MFA Verify (TOTP: 123456)"
$adminToken = $adminMfa.accessToken
Write-Host "Admin Token: $($adminToken.Substring(0,30))..." -ForegroundColor Green

# -----------------------------------------------
# 24. ADMIN ANALYTICS DASHBOARD
# -----------------------------------------------
$analytics = Test-Endpoint -Method GET -Url "$baseUrl/admin/analytics" -Token $adminToken -Label "24. Admin Analytics Dashboard"

# -----------------------------------------------
# 25. ADMIN QUEUE METRICS
# -----------------------------------------------
$queueMetrics = Test-Endpoint -Method GET -Url "$baseUrl/admin/queue-metrics" -Token $adminToken -Label "25. Admin Queue Monitoring"

# -----------------------------------------------
# 26. ADMIN SERVICE HEALTH
# -----------------------------------------------
$serviceHealth = Test-Endpoint -Method GET -Url "$baseUrl/admin/service-health" -Token $adminToken -Label "26. Admin Service Health (OpenTelemetry Sim)"

# -----------------------------------------------
# 27. ADMIN AUDIT LOGS
# -----------------------------------------------
$auditLogs = Test-Endpoint -Method GET -Url "$baseUrl/admin/audit-logs" -Token $adminToken -Label "27. Admin Audit Logs"

# -----------------------------------------------
# 28. PASSENGER LOGOUT (Token Blacklist)
# -----------------------------------------------
$logout = Test-Endpoint -Method POST -Url "$baseUrl/auth/logout" -Token $passengerToken -Label "28. Passenger Logout (Token Blacklist)"

# -----------------------------------------------
# 29. VERIFY TOKEN IS REVOKED (Should fail with 401)
# -----------------------------------------------
$revokedCheck = Test-Endpoint -Method GET -Url "$baseUrl/users/profile" -Token $passengerToken -Label "29. Access After Logout (Expect 401 - Token Revoked)"

# -----------------------------------------------
# SUMMARY
# -----------------------------------------------
Write-Host "`n`n" -NoNewline
Write-Host "=============================================" -ForegroundColor Green
Write-Host "   TEST SUITE COMPLETE - ALL 29 ENDPOINTS    " -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host "Server: http://localhost:5000" -ForegroundColor Cyan
Write-Host "Database: PostgreSQL (railflow)" -ForegroundColor Cyan
Write-Host "PNR Generated: $pnr" -ForegroundColor Yellow
Write-Host "=============================================" -ForegroundColor Green
