export type AppRole = "STUDENT" | "TEACHER";

export interface SessionProfile {
  id: string;
  authUserId: string;
  loginId: string;
  displayName: string;
  role: AppRole;
  teamId: string | null;
  canManageAccounts: boolean;
  canManageTeams: boolean;
  canManageAssessments: boolean;
  canManagePlanning: boolean;
  mustChangePassword: boolean;
}

export interface MeResponse {
  profile: SessionProfile;
}

export interface StudentBookingSummary {
  id: string;
  startsAt: string;
  endsAt: string;
  roomName: string;
  subject: string;
  learningHouse: string;
  assessmentTitle: string;
  comment: string | null;
  status: "PLANNED" | "COMPLETED" | "CANCELLED";
  version: number;
  cancellationAllowed: boolean;
  cancellationDeadline: string;
}

export interface StudentOverviewResponse {
  bookings: StudentBookingSummary[];
}

export interface TeacherOverviewResponse {
  counts: {
    teams: number;
    students: number;
    upcomingBookings: number;
    upcomingAppointments: number;
  };
}

export interface TeamSummary {
  id: string;
  name: string;
  studentCount: number;
}

export interface StudentAccountSummary {
  id: string;
  displayName: string;
  loginId: string;
  teamId: string | null;
  teamName: string | null;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}

export interface StudentManagementResponse {
  teams: TeamSummary[];
  students: StudentAccountSummary[];
  teachers: TeacherAccountSummary[];
  invitations: TeamInvitationSummary[];
}

export interface TeacherAccountSummary {
  id: string;
  displayName: string;
  loginId: string;
  active: boolean;
  canManageAccounts: boolean;
  canManageTeams: boolean;
  canManageAssessments: boolean;
  canManagePlanning: boolean;
  teamIds: string[];
  createdAt: string;
}

export interface CreateTeacherResponse {
  teacher: TeacherAccountSummary;
  initialPassword: string;
}

export interface TeamInvitationSummary {
  id: string;
  teamId: string;
  teamName: string;
  expiresAt: string;
  maxUses: number;
  useCount: number;
  active: boolean;
  createdAt: string;
}

export interface CreateInvitationResponse {
  invitation: TeamInvitationSummary;
  token: string;
}

export interface PublicInvitationResponse {
  teamName: string;
  expiresAt: string;
  remainingUses: number;
}

export interface RedeemInvitationResponse {
  displayName: string;
  loginId: string;
  teamName: string;
}

export interface CreateTeamResponse {
  team: TeamSummary;
}

export interface CreateStudentResponse {
  student: StudentAccountSummary;
  initialPassword: string;
}

export interface BatchStudentCredential {
  displayName: string;
  loginId: string;
  initialPassword: string;
}

export interface BatchCreateStudentsResponse {
  teamName: string;
  accounts: BatchStudentCredential[];
  failures: Array<{ displayName: string; message: string }>;
}

export interface ChangePasswordResponse {
  changed: true;
}

export interface RoomSummary {
  id: string;
  name: string;
  defaultCapacity: number;
  active: boolean;
}

export interface AssessmentSummary {
  id: string;
  subject: string;
  learningHouse: string;
  title: string;
  active: boolean;
  teamIds: string[];
}

export interface WeeklyScheduleSummary {
  id: string;
  name: string;
  weekday: number;
  localStartTime: string;
  localEndTime: string;
  startsOn: string;
  endsOn: string;
  roomId: string;
  roomName: string;
  capacity: number;
  active: boolean;
  occurrenceCount: number;
}

export interface AppointmentSummary {
  id: string;
  scheduleId: string | null;
  startsAt: string;
  endsAt: string;
  roomId: string;
  roomName: string;
  capacity: number;
  booked: number;
  status: "OPEN" | "CANCELLED";
  version: number;
}

export interface BookingSettingsSummary {
  bookingCutoffHours: number;
  cancellationCutoffHours: number;
}

export interface PlanningAdminResponse {
  rooms: RoomSummary[];
  assessments: AssessmentSummary[];
  schedules: WeeklyScheduleSummary[];
  appointments: AppointmentSummary[];
  teams: TeamSummary[];
  settings: BookingSettingsSummary;
}

export interface PlannerAppointment extends AppointmentSummary {
  remaining: number;
  registrationOpen: boolean;
  restrictionReason: string | null;
  ownBookingId: string | null;
}

export interface StudentPlannerResponse {
  teamName: string | null;
  assessments: AssessmentSummary[];
  appointments: PlannerAppointment[];
}

export interface CreateBookingResponse {
  bookingId: string;
}

export interface CoachAssessmentState {
  assessmentId: string;
  subject: string;
  learningHouse: string;
  title: string;
  status: "OPEN" | "PLANNED" | "COMPLETED";
}

export interface CoachStudentSummary {
  studentId: string;
  displayName: string;
  teamId: string | null;
  teamName: string | null;
  assessments: CoachAssessmentState[];
}

export interface TeacherBookingSummary extends StudentBookingSummary {
  studentId: string;
  studentName: string;
  teamId: string | null;
  teamName: string | null;
}

export interface TeacherCoachResponse {
  students: CoachStudentSummary[];
  bookings: TeacherBookingSummary[];
}

export interface ResetStudentPasswordResponse {
  initialPassword: string;
}

export interface SystemStatusResponse {
  backup: {
    lastSuccessAt: string | null;
    lastFilename: string | null;
    lastError: string | null;
    directory: string;
    mirrorConfigured: boolean;
  };
  transportSecurity: "http" | "https";
  productionMode: boolean;
}

export interface DemoDataCounts {
  teams: number;
  students: number;
  rooms: number;
  assessments: number;
  schedules: number;
  appointments: number;
  bookings: number;
}

export interface DemoDataStatusResponse {
  active: boolean;
  createdAt: string | null;
  counts: DemoDataCounts;
}

export interface DemoCredential {
  displayName: string;
  teamName: string;
  loginId: string;
  initialPassword: string;
}

export interface CreateDemoDataResponse {
  status: DemoDataStatusResponse;
  credentials: DemoCredential[];
}

export interface DeleteDemoDataResponse {
  deleted: boolean;
  status: DemoDataStatusResponse;
}

export interface ApiErrorResponse {
  error: string;
  message: string;
}
