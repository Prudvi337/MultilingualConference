#!/bin/bash

# Backend API Test Script
# Tests LiveKit integration endpoints

API_BASE="http://localhost:3001/api"
TEST_ROOM="test-room-$(date +%s)"
TEST_PARTICIPANT="TestUser"

echo "╔════════════════════════════════════════════════════════╗"
echo "║     BACKEND API INTEGRATION TEST SCRIPT                ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;36m'
NC='\033[0m' # No Color

# Function to test endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4

    echo -e "${BLUE}🧪 Testing: $description${NC}"
    echo -e "   ${YELLOW}$method $endpoint${NC}"

    if [ -z "$data" ]; then
        # GET request
        response=$(curl -s -X $method "$API_BASE$endpoint" \
            -H "Content-Type: application/json")
    else
        # POST request
        response=$(curl -s -X $method "$API_BASE$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data")
    fi

    echo "   Response:"
    echo "$response" | jq '.' 2>/dev/null || echo "$response"
    echo ""
}

# =====================================================================
# TEST 1: Health Check
# =====================================================================
test_endpoint "GET" "/health" "" "Health Check"

# =====================================================================
# TEST 2: List Existing Rooms
# =====================================================================
test_endpoint "GET" "/rooms" "" "List Existing Rooms"

# =====================================================================
# TEST 3: Get Translation Status
# =====================================================================
test_endpoint "GET" "/translation/status" "" "Translation Service Status"

# =====================================================================
# TEST 4: Generate Token for Participant 1
# =====================================================================
TOKEN_REQ=$(cat <<EOF
{
  "roomName": "$TEST_ROOM",
  "participantName": "Alice",
  "targetLanguage": "en"
}
EOF
)
test_endpoint "POST" "/token" "$TOKEN_REQ" "Generate Token - Alice (English)"

# =====================================================================
# TEST 5: Generate Token for Participant 2
# =====================================================================
TOKEN_REQ=$(cat <<EOF
{
  "roomName": "$TEST_ROOM",
  "participantName": "Bob",
  "targetLanguage": "es"
}
EOF
)
test_endpoint "POST" "/token" "$TOKEN_REQ" "Generate Token - Bob (Spanish)"

# =====================================================================
# TEST 6: Generate Token for Participant 3
# =====================================================================
TOKEN_REQ=$(cat <<EOF
{
  "roomName": "$TEST_ROOM",
  "participantName": "Charlie",
  "targetLanguage": "fr"
}
EOF
)
test_endpoint "POST" "/token" "$TOKEN_REQ" "Generate Token - Charlie (French)"

# =====================================================================
# TEST 7: Start Translation Worker
# =====================================================================
WORKER_REQ=$(cat <<EOF
{
  "roomName": "$TEST_ROOM"
}
EOF
)
test_endpoint "POST" "/worker/start" "$WORKER_REQ" "Start Translation for Room"

# =====================================================================
# TEST 8: Verify Room Was Created
# =====================================================================
test_endpoint "GET" "/rooms" "" "Verify Room Created - List All Rooms"

echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║ ✅ API TEST COMPLETE                                  ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Test Room: $TEST_ROOM${NC}"
echo -e "${YELLOW}Participants: Alice (EN), Bob (ES), Charlie (FR)${NC}"
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo "  1. Verify all endpoints returned 200 status"
echo "  2. Check token structure (should be JWT with 3 parts)"
echo "  3. Start frontend and join participants to the room"
echo "  4. Test WebSocket connection for translation"
echo ""
