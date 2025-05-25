#!/bin/bash

# Simple test script for transcription API endpoints
echo "Testing Transcription API Endpoints"
echo "==================================="

# Test the legacy Whisper API token endpoint
echo -e "\n1. Testing Whisper API token endpoint"
curl -s -X POST "http://localhost:8787/api/transcription-token" -H "Content-Type: application/json" | jq .

# Test the Realtime API token endpoint (path-based)
echo -e "\n2. Testing Realtime API token endpoint (path-based)"
curl -s -X POST "http://localhost:8787/api/transcription-token/realtime" -H "Content-Type: application/json" | jq .

# Test the Realtime API token endpoint (query-based)
echo -e "\n3. Testing Realtime API token endpoint (query-based)"
curl -s -X POST "http://localhost:8787/api/transcription-token?type=realtime" -H "Content-Type: application/json" | jq .

echo -e "\nTests completed"
