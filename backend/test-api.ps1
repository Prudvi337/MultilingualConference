# Backend API Test Script for Windows (PowerShell)
# Tests LiveKit integration endpoints

$API_BASE = "http://localhost:3001/api"
$TEST_ROOM = "test-room-$(Get-Date -UFormat %s)"
$TEST_PARTICIPANT = "TestUser"

Write-Host "╔════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     BACKEND API INTEGRATION TEST SCRIPT (WINDOWS)      ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Function to test endpoint
function Test-Endpoint {
    param(
        [string]$Method,
        [string]$Endpoint,
        [string]$Data,
        [string]$Description
    )

    Write-Host "🧪 Testing: $Description" -ForegroundColor Cyan
    Write-Host "   $Method $Endpoint" -ForegroundColor Yellow

    try {
        $url = "$API_BASE$Endpoint"
        
        if ([string]::IsNullOrEmpty($Data)) {
            # GET request
            $response = Invoke-RestMethod -Uri $url -Method $Method `
                -Headers @{"Content-Type" = "application/json"} `
                -ErrorAction Stop
        } else {
            # POST request
            $response = Invoke-RestMethod -Uri $url -Method $Method `
                -Headers @{"Content-Type" = "application/json"} `
                -Body $Data `
                -ErrorAction Stop
        }

        Write-Host "   Response:" -ForegroundColor Green
        $response | ConvertTo-Json | Write-Host
        Write-Host ""
    } catch {
        Write-Host "   ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host ""
    }
}

# =====================================================================
# TEST 1: Health Check
# =====================================================================
Test-Endpoint -Method "GET" -Endpoint "/health" -Description "Health Check"

# =====================================================================
# TEST 2: List Existing Rooms
# =====================================================================
Test-Endpoint -Method "GET" -Endpoint "/rooms" -Description "List Existing Rooms"

# =====================================================================
# TEST 3: Get Translation Status
# =====================================================================
Test-Endpoint -Method "GET" -Endpoint "/translation/status" -Description "Translation Service Status"

# =====================================================================
# TEST 4: Generate Token for Alice
# =====================================================================
$TokenReq = @{
    roomName = $TEST_ROOM
    participantName = "Alice"
    targetLanguage = "en"
} | ConvertTo-Json

Test-Endpoint -Method "POST" -Endpoint "/token" -Data $TokenReq `
    -Description "Generate Token - Alice (English)"

# =====================================================================
# TEST 5: Generate Token for Bob
# =====================================================================
$TokenReq = @{
    roomName = $TEST_ROOM
    participantName = "Bob"
    targetLanguage = "es"
} | ConvertTo-Json

Test-Endpoint -Method "POST" -Endpoint "/token" -Data $TokenReq `
    -Description "Generate Token - Bob (Spanish)"

# =====================================================================
# TEST 6: Generate Token for Charlie
# =====================================================================
$TokenReq = @{
    roomName = $TEST_ROOM
    participantName = "Charlie"
    targetLanguage = "fr"
} | ConvertTo-Json

Test-Endpoint -Method "POST" -Endpoint "/token" -Data $TokenReq `
    -Description "Generate Token - Charlie (French)"

# =====================================================================
# TEST 7: Start Translation Worker
# =====================================================================
$WorkerReq = @{
    roomName = $TEST_ROOM
} | ConvertTo-Json

Test-Endpoint -Method "POST" -Endpoint "/worker/start" -Data $WorkerReq `
    -Description "Start Translation for Room"

# =====================================================================
# TEST 8: Verify Room Was Created
# =====================================================================
Test-Endpoint -Method "GET" -Endpoint "/rooms" -Description "Verify Room Created - List All Rooms"

Write-Host "╔════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║ ✅ API TEST COMPLETE                                  ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "Test Room: $TEST_ROOM" -ForegroundColor Yellow
Write-Host "Participants: Alice (EN), Bob (ES), Charlie (FR)" -ForegroundColor Yellow
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Verify all endpoints returned 200 status"
Write-Host "  2. Check token structure (should be JWT with 3 parts)"
Write-Host "  3. Start frontend and join participants to the room"
Write-Host "  4. Test WebSocket connection for translation"
Write-Host ""
