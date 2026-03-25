package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"math/rand"
	"net/http"
	"github.com/gin-gonic/gin"
)

type PredictRequest struct {
	State []float64 `json:"state"`
}

type PredictResponse struct {
	Action  int       `json:"action"`
	QValues []float64 `json:"q_values"`
}

func BrainPredictHandler(c *gin.Context) {
	var req PredictRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid state data"})
		return
	}

	// --- Epsilon-Greedy Exploration ---
	epsilon := 0.1 // 10% Exploration
	if rand.Float64() < epsilon {
		action := rand.Intn(5) // Assuming 5 possible actions
		log.Printf("[Exploration] Random action chosen: %d\n", action)
		c.JSON(http.StatusOK, PredictResponse{
			Action:  action,
			QValues: []float64{0, 0, 0, 0, 0}, // No Q-values for random action
		})
		return
	}
	// ----------------------------------

	// Proxy to Python ML Service
	jsonData, err := json.Marshal(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to marshal request"})
		return
	}

	resp, err := http.Post("http://localhost:8000/predict", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "ML Service offline", "action": 0})
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var predictResp PredictResponse
	if err := json.Unmarshal(body, &predictResp); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse ML response", "action": 0})
		return
	}

	c.JSON(http.StatusOK, predictResp)
}
