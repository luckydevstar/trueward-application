"use client";

import {
  DeleteOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  GithubOutlined,
  LinkedinOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Col,
  DatePicker,
  Divider,
  Form,
  Input,
  Modal,
  Row,
  Space,
  Tooltip,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useState } from "react";

import { revealSsn } from "@/app/dashboard/profiles/ssn-actions";

export type EmploymentValues = {
  id: string;
  company: string;
  location?: string;
  startDate?: dayjs.Dayjs;
  endDate?: dayjs.Dayjs | null;
  additionalInfo?: string;
};

export type EducationValues = {
  school: string;
  degree: string;
  location?: string;
  year?: dayjs.Dayjs | null;
  additionalInfo?: string;
};

export type ProfileFormValues = {
  fullName: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  birthday?: dayjs.Dayjs | null;
  githubUrl?: string;
  linkedinUrl?: string;
  ssn?: string;
  employments?: EmploymentValues[];
  education?: EducationValues[];
};

type Props = {
  open: boolean;
  busy: boolean;
  /** Set when editing; drives the SSN reveal, which needs a saved row. */
  profileId?: string;
  canSeeSsn: boolean;
  hasSsn?: boolean;
  initialValues?: Partial<ProfileFormValues>;
  onCancel: () => void;
  onSubmit: (values: ProfileFormValues) => void;
};

export function ProfileEditor({
  open,
  busy,
  profileId,
  canSeeSsn,
  hasSsn,
  initialValues,
  onCancel,
  onSubmit,
}: Props) {
  const [form] = Form.useForm<ProfileFormValues>();

  return (
    <Modal
      title={initialValues ? "Edit profile" : "New profile"}
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={busy}
      okText="Save"
      width={860}
      destroyOnHidden
    >
      <Form<ProfileFormValues>
        form={form}
        layout="vertical"
        onFinish={onSubmit}
        requiredMark={false}
        initialValues={initialValues}
        style={{ maxHeight: "68vh", overflowY: "auto", paddingRight: 12 }}
      >
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item
              name="fullName"
              label="Full name"
              rules={[{ required: true, message: "Enter the full name" }]}
            >
              <Input placeholder="Jane Doe" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              name="email"
              label="Email"
              rules={[
                { required: true, message: "Enter an email" },
                { type: "email", message: "That doesn't look like an email" },
              ]}
            >
              <Input placeholder="jane@example.com" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="phone" label="Phone">
              <Input placeholder="+1 555 0100" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="birthday" label="Birthday">
              <DatePicker
                style={{ width: "100%" }}
                // A birthday in the future is always a typo.
                maxDate={dayjs()}
              />
            </Form.Item>
          </Col>
        </Row>

        <Divider titlePlacement="start">Address</Divider>
        <Row gutter={12}>
          <Col xs={24}>
            <Form.Item name="address" label="Street address">
              <Input placeholder="120 Main St, Apt 4" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="city" label="City">
              <Input placeholder="Boston" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="state" label="State">
              <Input placeholder="MA" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="postalCode" label="Postal code">
              <Input placeholder="02108" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="country" label="Country">
              <Input placeholder="United States" />
            </Form.Item>
          </Col>
        </Row>

        <Divider titlePlacement="start">Links</Divider>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item
              name="githubUrl"
              label="GitHub"
              rules={[{ type: "url", message: "Enter a full URL" }]}
            >
              <Input prefix={<GithubOutlined />} placeholder="https://github.com/…" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              name="linkedinUrl"
              label="LinkedIn"
              rules={[{ type: "url", message: "Enter a full URL" }]}
            >
              <Input
                prefix={<LinkedinOutlined />}
                placeholder="https://linkedin.com/in/…"
              />
            </Form.Item>
          </Col>
        </Row>

        {canSeeSsn && (
          <>
            <Divider titlePlacement="start">Sensitive</Divider>
            <SsnField profileId={profileId} hasSsn={hasSsn} />
          </>
        )}

        <Divider titlePlacement="start">Employment</Divider>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          Each entry needs a stable id. Resume content references employers by
          that id, which is what stops a generated resume from inventing one.
        </Typography.Paragraph>
        <Form.List name="employments">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <div
                  key={field.key}
                  style={{
                    border: "1px solid #f0f0f0",
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 12,
                  }}
                >
                  <Row gutter={12}>
                    <Col xs={24} sm={6}>
                      <Form.Item
                        name={[field.name, "id"]}
                        label="Id"
                        rules={[{ required: true, message: "Id" }]}
                      >
                        <Input placeholder="acme-2021" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={10}>
                      <Form.Item
                        name={[field.name, "company"]}
                        label="Company"
                        rules={[{ required: true, message: "Company" }]}
                      >
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={20} sm={7}>
                      <Form.Item name={[field.name, "location"]} label="Location">
                        <Input placeholder="Remote" />
                      </Form.Item>
                    </Col>
                    <Col xs={4} sm={1}>
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => remove(field.name)}
                        style={{ marginTop: 30 }}
                      />
                    </Col>
                    <Col xs={12} sm={6}>
                      <Form.Item
                        name={[field.name, "startDate"]}
                        label="Start"
                        rules={[{ required: true, message: "Start date" }]}
                      >
                        {/*
                          Month precision, because that is all a resume shows.
                          A full date picker would capture a day the renderer
                          then has to discard.
                        */}
                        <DatePicker picker="month" style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={6}>
                      <Form.Item
                        name={[field.name, "endDate"]}
                        label="End"
                        extra="Blank means Present"
                      >
                        <DatePicker picker="month" style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24}>
                      <Form.Item
                        name={[field.name, "additionalInfo"]}
                        label="Additional info"
                        extra="Projects, stack, team size, outcomes. Never printed — this is source material for generating resume content, so be exhaustive."
                      >
                        <Input.TextArea rows={3} />
                      </Form.Item>
                    </Col>
                  </Row>
                </div>
              ))}
              <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add()}>
                Add employment
              </Button>
            </>
          )}
        </Form.List>

        <Divider titlePlacement="start">Education</Divider>
        <Form.List name="education">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <div
                  key={field.key}
                  style={{
                    border: "1px solid #f0f0f0",
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 12,
                  }}
                >
                  <Row gutter={12}>
                    <Col xs={24} sm={9}>
                      <Form.Item
                        name={[field.name, "school"]}
                        label="School"
                        rules={[{ required: true, message: "School" }]}
                      >
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={9}>
                      <Form.Item
                        name={[field.name, "degree"]}
                        label="Degree"
                        rules={[{ required: true, message: "Degree" }]}
                      >
                        <Input placeholder="BSc Computer Science" />
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={5}>
                      <Form.Item name={[field.name, "year"]} label="Year">
                        <DatePicker picker="year" style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={4} sm={1}>
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => remove(field.name)}
                        style={{ marginTop: 30 }}
                      />
                    </Col>
                    <Col xs={24} sm={8}>
                      <Form.Item name={[field.name, "location"]} label="Location">
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={24}>
                      <Form.Item
                        name={[field.name, "additionalInfo"]}
                        label="Additional info"
                        extra="Coursework, honours, thesis. Never printed — source material only."
                      >
                        <Input.TextArea rows={2} />
                      </Form.Item>
                    </Col>
                  </Row>
                </div>
              ))}
              <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add()}>
                Add education
              </Button>
            </>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
}

/**
 * SSN entry and reveal.
 *
 * The stored value is never sent with the page — the field starts blank even
 * when one exists, and the plaintext only arrives after an explicit reveal that
 * the server logs. Typing a new value replaces it; leaving it blank leaves the
 * stored one alone.
 */
function SsnField({
  profileId,
  hasSsn,
}: {
  profileId?: string;
  hasSsn?: boolean;
}) {
  const { message } = App.useApp();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reveal = async () => {
    if (!profileId) return;
    setLoading(true);
    const result = await revealSsn(profileId);
    setLoading(false);

    if (!result.ok) {
      message.error(result.error);
      return;
    }
    if (!result.ssn) {
      message.info("No SSN is stored for this profile.");
      return;
    }
    setRevealed(result.ssn);
    message.warning("Revealed — this access has been logged.");
  };

  return (
    <>
      <Form.Item
        name="ssn"
        label="Social Security number"
        extra={
          hasSsn
            ? "One is on file. Leave blank to keep it; type a new one to replace it."
            : "Stored encrypted. Only admins can reveal it, and every reveal is logged."
        }
        rules={[
          {
            validator: (_, value: string) => {
              if (!value) return Promise.resolve();
              const digits = value.replace(/\D/g, "");
              return digits.length === 9
                ? Promise.resolve()
                : Promise.reject(new Error("A Social Security number has 9 digits"));
            },
          },
        ]}
      >
        <Input.Password
          placeholder={hasSsn ? "•••-••-••••" : "123-45-6789"}
          autoComplete="off"
          iconRender={(visible) =>
            visible ? <EyeOutlined /> : <EyeInvisibleOutlined />
          }
        />
      </Form.Item>

      {hasSsn && profileId && (
        <Space orientation="vertical" style={{ width: "100%", marginBottom: 16 }}>
          <Tooltip title="Decrypts server-side and writes an audit entry">
            <Button size="small" loading={loading} onClick={reveal}>
              Reveal stored number
            </Button>
          </Tooltip>
          {revealed && (
            <Alert
              type="warning"
              showIcon
              title={
                <Typography.Text copyable code>
                  {revealed.replace(/^(\d{3})(\d{2})(\d{4})$/, "$1-$2-$3")}
                </Typography.Text>
              }
              description="This reveal was recorded in the access log."
            />
          )}
        </Space>
      )}
    </>
  );
}
