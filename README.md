# Homebase: Your Personal Home Lab Dashboard

Homebase is a self-hosted operations center designed for high school students and developers running a home server. It provides a centralized web interface to monitor server stats, manage Docker containers, access a web-based terminal, organize projects, and keep track of class-related links.

## Features

### Authentication
- **Simple Login**: Secure access using a username and password.
- **Default Credentials**: 
  - **Username**: `xube`
  - **Password**: `7860`
- **Session Management**: User sessions are maintained using JWT (JSON Web Tokens) stored in local storage.

### Dashboard Layout
- **Persistent Left Sidebar**: Navigation with icons and labels for easy access to different sections:
    1.  Overview (Server Stats)
    2.  Terminal
    3.  Docker
    4.  Project Board
    5.  Class Links
- **Top Bar**: Displays the app logo/name "Homebase", current user name, and a logout button.

### 1. Server Stats (Overview Page)
- **Real-time Monitoring**: Displays CPU usage (%), RAM usage (%), Disk usage (%), and Network in/out (KB/s).
- **System Information**: Shows system uptime, hostname, and OS information.
- **Visualizations**: Clean metric cards with sparkline-style mini charts.
- **Data Polling**: Backend endpoint polls system stats every 5 seconds.

### 2. SSH Terminal
- **Web-based SSH**: Embeds an interactive web-based SSH terminal using **xterm.js** on the frontend.
- **Saved Machines**: Store multiple SSH machines with host, port, username, and password or private-key authentication.
- **Real Shell Session**: Backend uses `ssh2` and WebSockets to pipe a real remote SSH shell session to the browser.
- **Reconnect Functionality**: Connect to any saved machine from the terminal page.
- **Customizable Theme**: Dark terminal theme, monospace font, and full keyboard support.

### 3. Docker Container Manager
- **Container Listing**: Lists all Docker containers with details such as name, image, status (running/stopped/paused), exposed ports, and creation time.
- **Container Actions**: Buttons to Start, Stop, Restart, and Remove containers.
- **Log Viewer**: Displays container logs (last 100 lines, auto-scrolling) in a modal or drawer.
- **Image Pull**: Input field and button to pull new Docker images.
- **Docker SDK Integration**: Interacts with the Docker daemon via `/var/run/docker.sock` using `dockerode`.
- **Status Badges**: Color-coded status badges (green for running, red for stopped, yellow for paused).

### 4. Project Board
- **Kanban-style Board**: Features columns for To Do, In Progress, and Done tasks.
- **Task Cards**: Each card includes a title, description, priority tag (Low/Med/High), optional due date, and an organization label.
- **Organization Filter**: Users can create and filter the board by organizations (e.g., "Haqqconsulting", "Tareeq Al Haqq", "School", "Personal").
- **Drag-and-Drop**: Cards can be dragged and dropped between columns (using `@dnd-kit`).
- **CRUD Operations**: Add, edit, and delete cards via a modal form.
- **Data Persistence**: Data is stored in a SQLite database on the backend.

### 5. Class Links
- **Curated Link Organizer**: Allows users to add links with a title, URL, subject/category (e.g., AP Bio, AP Lit, Science Olympiad, Tareeq), color tag, and optional notes.
- **Responsive Display**: Links are displayed as a responsive grid of cards, groupable and filterable by category.
- **Direct Access**: Clicking a card opens the URL in a new tab.
- **CRUD Operations**: Add, edit, and delete links via a modal.
- **Data Persistence**: Data is stored in the same SQLite database as the project board.

## Tech Stack

-   **Frontend**: React, Vite, Tailwind CSS, xterm.js, @dnd-kit
-   **Backend**: Node.js (Express)
-   **Authentication**: JWT-based authentication
-   **Database**: SQLite (via `better-sqlite3`) for Project Board and Class Links data
-   **Docker Integration**: `dockerode`
-   **System Stats**: `systeminformation`
-   **Terminal**: xterm.js + node-pty + Socket.IO WebSocket

## Design

-   **Dark Theme**: Deep navy/slate background (`#0d1117`), monospace accents, subtle blue or amber highlight colors.
-   **Aesthetic**: Clean, utilitarian design, resembling a developer tool.
-   **Navigation**: Sidebar navigation with Lucide icons.
-   **Layout**: Consistent card-based layout across all sections.
-   **Responsiveness**: Optimized for desktop use (1280px+ primary target).
-   **Transitions**: Smooth page transitions between sections.

## Deployment

Homebase is designed for self-hosting using Docker and Docker Compose.

### Prerequisites
-   Docker and Docker Compose installed on your home server.

### Setup Instructions

1.  **Clone the Repository**:
    ```bash
    git clone <repository-url>
    cd homebase
    ```

2.  **Configure Environment Variables**:
    Copy the example environment file and fill in your details:
    ```bash
    cp .env.example .env
    ```
    Edit the `.env` file with your specific values:
    -   `JWT_SECRET`: A strong, random string for JWT signing.

    Saved SSH machine credentials are stored in the SQLite database used by Homebase, so keep the database file private.

3.  **Docker Socket Permissions**:
    The backend service needs access to the Docker daemon socket (`/var/run/docker.sock`) to manage containers. Ensure the user running Docker Compose has appropriate permissions. You might need to add your user to the `docker` group on your host machine:
    ```bash
    sudo usermod -aG docker $USER
    # You may need to log out and log back in for the changes to take effect.
    ```

4.  **Run with Docker Compose**:
    From the root directory of the `homebase` project, run:
    ```bash
    docker-compose up --build -d
    ```
    This command will:
    -   Build the `server` and `client` Docker images.
    -   Create and start the `homebase-server` and `homebase-client` containers.
    -   Map port `3001` on your host to the server container and port `3000` on your host to the client container (via port `80` in the client container).
    -   Mount the Docker socket and the SQLite database file into the server container.

### Accessing Homebase

Once the containers are up and running, you can access Homebase in your web browser at:

```
http://localhost:3000
```

**Login Credentials:**
- **Username**: `xube`
- **Password**: `7860`

Enjoy your personal home lab dashboard!
