function wrapWithEmailTemplate({
    subjectTitle,
    bodyContent
}: {
    subjectTitle: string;
    bodyContent: string;
}): string {

    const logoUrl = process.env.LOGO_URL || "https://storage.googleapis.com/tendly/Tendly_logo_Full.png";

    return `
  <div style="background-color: #f4f4f4; padding: 30px 0; font-family: Arial, sans-serif;">
    <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 0 5px rgba(0,0,0,0.1);">
      <div style="text-align: center; padding: 20px;">
        <img src="${logoUrl}" alt="HRMS Logo" style="max-width: 150px; height: auto;" />
      </div>
      <div style="padding: 0 30px 30px;">
        <h2 style="color: #333; margin-bottom: 20px;">${subjectTitle}</h2>
        ${bodyContent}
        <p style="margin-top: 40px; color: #777; font-size: 12px; text-align: center;">
          HRMS - Next Generation Human Resource Management
        </p>
      </div>
    </div>
  </div>
  `;
}
