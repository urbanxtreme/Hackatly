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

	r := gin.Default()
	r.POST("/register", RegisterHandler)
	r.POST("/login", LoginHandler)

	// Protected Routes
	protected := r.Group("/")
	protected.Use(AuthMiddleware())
	{
		// Robot Routes
		protected.POST("/robots", AddRobotHandler)
		protected.GET("/robots", GetAllRobotsHandler)
		protected.GET("/robots/:id", GetRobotByIDHandler)
		protected.PATCH("/robots/:id/state", UpdateRobotStateHandler)
		protected.PATCH("/robots/:id/priority", UpdateRobotPriorityHandler)

		// Log Routes
		protected.GET("/logs", GetLogsHandler)
		protected.POST("/logs", AddLogHandler)
	}

	fmt.Println("Server starting on http://localhost:3000")
	if err := r.Run(":3000"); err != nil {
		log.Fatalf("Failed to run server: %v\n", err)
	}
}