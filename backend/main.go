package main

import (
	"fmt"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {

	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, relying on system environment variables")
	}

	_, err := ConnectDatabase()
	if err != nil {
		log.Fatalf("Failed to connect to database: %v\n", err)
	}
	defer DisconnectDatabase()

	if err := CreateDatabase(); err != nil {
		log.Fatalf("Failed to create database: %v\n", err)
	}

	r := gin.Default() // Routes
	r.POST("/register", RegisterHandler)
	r.POST("/login", LoginHandler)

	// Robot Routes
	r.POST("/robots", AddRobotHandler)
	r.GET("/robots", GetAllRobotsHandler)
	r.GET("/robots/:id", GetRobotByIDHandler)
	r.PATCH("/robots/:id/state", UpdateRobotStateHandler)
	r.PATCH("/robots/:id/priority", UpdateRobotPriorityHandler)

	// Log Routes
	r.GET("/logs", GetLogsHandler)
	r.POST("/logs", AddLogHandler)

	fmt.Println("Server starting on http://localhost:3000")
	if err := r.Run(":3000"); err != nil {
		log.Fatalf("Failed to run server: %v\n", err)
	}
}