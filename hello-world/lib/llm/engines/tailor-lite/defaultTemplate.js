// The bundled default résumé template. The embedded engine fills ITS OWN
// template (it never receives the user's uploaded .docx — the route passes only
// extracted text), so the résumé content + layout live here as controlled OOXML
// and are user-editable in this one file.
//
// This mirrors the owner's real résumé so the deterministic output looks like a
// finished, professional document. Only a few values are placeholders:
//   {{FULL_NAME}}, {{CONTACT_LINE}}  -> from profile.json
//   {{CORE_COMPETENCIES}}            -> the owner's own skills that match the
//                                       posting (with a fallback, so it always
//                                       fills and never leaks raw braces).
// Everything else is static résumé content.

import { buildDocumentXml, buildDocxBuffer } from "./docxPackage.js";

// Sizes are half-points: 32=16pt, 26=13pt, 22=11pt, 21=10.5pt, 20=10pt.
const HEADER = "26";
const BODY = "21";

const header = (text) => ({ text, bold: true, size: HEADER, color: "1F3A5F", spaceBefore: 200, spaceAfter: 60 });
const body = (text) => ({ text, size: BODY, spaceAfter: 60 });
const bullet = (text) => ({ text, size: BODY, bullet: true, spaceAfter: 40 });
const entry = (title) => ({ text: title, bold: true, size: "22", spaceBefore: 100, spaceAfter: 30 });
// "Bold lead | rest of line" (e.g. a degree or skills category).
const lead = (boldPart, rest = "") => ({
  runs: [{ text: boldPart, bold: true }, { text: rest }],
  size: BODY,
  spaceBefore: 40,
  spaceAfter: 20,
});

const PARAGRAPHS = [
  { text: "{{FULL_NAME}}", bold: true, size: "32", spaceAfter: 20 },
  { text: "{{CONTACT_LINE}}", size: "20", color: "555555", spaceAfter: 80 },

  header("Summary"),
  body(
    "Senior Applications Engineer and Healthcare Integration Developer with 7+ years of experience building scalable enterprise applications, healthcare integration solutions, SQL-driven systems, and API platforms supporting 10,000+ users and 75,000+ daily application events in highly regulated environments. Experienced with JavaScript, TypeScript, SQL, React, PostgreSQL, REST APIs, backend integrations, Agile development, technical solution design, peer reviews, data transformation, and enterprise application modernization.",
  ),
  { runs: [{ text: "Most relevant to this role: ", bold: true }, { text: "{{CORE_COMPETENCIES}}" }], size: BODY, color: "333333", spaceAfter: 80 },

  header("Education"),
  lead("M.S. in Management Information Systems", " | Bellevue University | May 2026"),
  lead("B.S. in Computer Science", " | Missouri University of Science and Technology | May 2019"),

  header("Professional Experience"),
  entry("Senior Engineer (Applications & Enterprise Integrations) | Mutual of Omaha | July 2023"),
  bullet("Led enterprise application engineering initiatives supporting 10,000+ internal users and 75,000+ daily operational events while directing a frontend engineering team of 5 developers responsible for scalable enterprise applications, API integrations, SQL-backed operational workflows, reusable React component libraries, and enterprise modernization."),
  bullet("Designed, developed, tested, and enhanced enterprise software applications, SQL-backed operational systems, backend integrations, and API-driven workflows using React, JavaScript, TypeScript, SQL, REST APIs, PostgreSQL, HTML5, and CSS3 while improving scalability, interoperability readiness, maintainability, and deployment reliability across enterprise."),
  bullet("Collaborated with analysts, QA teams, developers, architects, and operational stakeholders to gather business requirements, develop conceptual and technical designs, support Agile delivery workflows, troubleshoot production issues, conduct peer reviews, and maintain enterprise development standards across distributed operational systems."),
  entry("Adjunct Professor (Software Development, APIs & Enterprise Systems) | Metropolitan College | Mar 2023"),
  bullet("Delivered software engineering, backend integration, database, API, and enterprise application development instruction to 100+ students per term while designing and modernizing 8+ project-based courses focused on REST APIs, SQL, frontend/backend integration, application testing, enterprise workflows, Agile development, and scalable architecture."),
  entry("Web Platforms Engineer | Mutual of Omaha | May 2022 to July 2023"),
  bullet("Developed enterprise applications, REST APIs, SQL-driven reporting solutions, and integration workflows supporting operational modernization, workflow automation, and large-scale data exchange systems."),
  bullet("Built scalable backend integrations, operational dashboards, and enterprise web platforms using JavaScript, TypeScript, SQL, React, HTML5, and CSS3 while improving maintainability, visibility, and integration reliability."),
  entry("Web Application Developer (Enterprise Systems & Software Development) | Union Pacific | May 2019 to May 2022"),
  bullet("Developed enterprise operational software, backend integrations, SQL reporting utilities, and large-scale data-processing systems supporting enterprise integrations and distributed environments."),
  bullet("Built data transformation workflows and enterprise software solutions using Java, Python, C++, SQL, and APIs while improving operational reliability, data accessibility, and integration efficiency."),

  header("Projects"),
  entry("Enterprise Applications Modernization & API Platform Engineering | Mutual of Omaha"),
  bullet("Led enterprise application modernization initiatives supporting platforms used by 10,000+ internal users and processing 75,000+ daily operational events through scalable React applications, SQL-backed operational systems, reusable component libraries, REST API integrations, frontend/backend modernization, and enterprise workflow improvements that increased maintainability, usability, and development efficiency."),
  entry("Enterprise Systems, APIs & Database Development Curriculum Modernization | Metropolitan College, Midland University"),
  bullet("Designed and modernized project-based curriculum supporting 100+ students per term focused on enterprise application development, SQL databases, REST APIs, backend/frontend integration, scalable software architecture, testing workflows, debugging, and Agile software engineering practices aligned with enterprise development environments."),

  header("Skills"),
  lead("Healthcare Interoperability & Enterprise Integration"),
  body("Healthcare Interoperability (HL7, FHIR, CCD/C-CDA), Healthcare Data Mapping, Payer Workflows, API-Based Architectures, Enterprise Integration Patterns, Systems Integration, Data Transformation, REST APIs, Backend Integration Workflows, Enterprise Application Modernization, Healthcare Data Exchange"),
  lead("Application Development & Software Engineering"),
  body("JavaScript, TypeScript, React, SQL Server, PostgreSQL, REST APIs, Web Application Development, Backend Services, Application Architecture, Database Development, Software Development Lifecycle (SDLC), Agile Development"),
  lead("Data Engineering & Enterprise Platforms"),
  body("SQL, Data Engineering, Operational Reporting, API Integrations, Workflow Automation, Enterprise Dashboards, Distributed Systems, Data Transformation Pipelines, Enterprise Software Platforms"),
  lead("Leadership & Cross-Functional Collaboration"),
  body("Technical Leadership, Code Reviews, Requirements Gathering, Stakeholder Communication, Agile Project Management, Cross-Functional Collaboration, Technical Documentation, Troubleshooting, Deployment Coordination, Mentorship"),
  lead("Collaboration & Enterprise Tools"),
  body("Git, GitHub, Jira, Microsoft Teams, Zoom, Google Workspace"),
];

const DOCUMENT_XML = buildDocumentXml(PARAGRAPHS);

let cache = null;

// Assemble (once) the default template as a Node Buffer ready for loadDocx().
export async function getDefaultTemplateBuffer() {
  if (!cache) cache = await buildDocxBuffer(DOCUMENT_XML);
  return cache;
}

export { DOCUMENT_XML as DEFAULT_DOCUMENT_XML };
