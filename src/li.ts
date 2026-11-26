// The `li` client contract. Agent scripts run by `lk run` program against this.
// `lk api` prints this file, so keep every exported name documented and stable.

export interface Position {
  title: string;
  company: string;
  location?: string;
  /** "YYYY-MM" */
  start?: string;
  /** "YYYY-MM"; absent means current. */
  end?: string;
  description?: string;
}

export interface Education {
  school: string;
  degree?: string;
  field?: string;
  start?: string;
  end?: string;
  description?: string;
}

/** My own profile: what LinkedIn shows as my CV. */
export interface Profile {
  publicId: string;
  name: string;
  headline: string;
  about: string;
  location: string;
  experience: Position[];
  education: Education[];
  skills: string[];
}

export interface JobSearchQuery {
  keywords: string;
  location?: string;
  remote?: "onsite" | "remote" | "hybrid";
  postedWithin?: "day" | "week" | "month";
  experience?: ("internship" | "entry" | "associate" | "mid-senior" | "director" | "executive")[];
  /** Max results; default 25. */
  limit?: number;
}

export interface JobSummary {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  postedAt?: string;
}

export interface JobDetail extends JobSummary {
  description: string;
  /** Skills LinkedIn lists for the job, if any. */
  skills: string[];
  seniority?: string;
  employmentType?: string;
  workplace?: "onsite" | "remote" | "hybrid";
  applicants?: number;
}

/** Result of a profile write. Without `lk run --write` nothing is sent and `applied` is false. */
export interface WriteResult<T> {
  applied: boolean;
  before: T;
  after: T;
}

export interface Li {
  profile: {
    get(): Promise<Profile>;
    updateHeadline(headline: string): Promise<WriteResult<string>>;
    updateAbout(about: string): Promise<WriteResult<string>>;
    updateLocation(location: string): Promise<WriteResult<string>>;
    addPosition(position: Position): Promise<WriteResult<Position | null>>;
    editPosition(index: number, patch: Partial<Position>): Promise<WriteResult<Position | null>>;
    removePosition(index: number): Promise<WriteResult<Position | null>>;
    addEducation(education: Education): Promise<WriteResult<Education | null>>;
    editEducation(index: number, patch: Partial<Education>): Promise<WriteResult<Education | null>>;
    removeEducation(index: number): Promise<WriteResult<Education | null>>;
    addSkill(skill: string): Promise<WriteResult<string[]>>;
    removeSkill(skill: string): Promise<WriteResult<string[]>>;
  };
  jobs: {
    search(query: JobSearchQuery): Promise<JobSummary[]>;
    get(id: string): Promise<JobDetail>;
    saved(): Promise<JobSummary[]>;
  };
}
